// File: pdfProcessor.js
// Ensure you have @google/generative-ai installed: npm install @google/generative-ai
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

// --- IMPORTANT: Configure your Gemini API Key ---
// It's best to use an environment variable for your API key.
const GEMINI_API_KEY = "AIzaSyDDlb1II3tqrBjeGtusqvqlkRZ5ePExZ7A"; 
if (!GEMINI_API_KEY) {
    console.warn("GEMINI_API_KEY environment variable is not set. API calls will fail.");
    // For local testing, you might hardcode it, but AVOID this in production.
    // throw new Error("GEMINI_API_KEY is not set."); 
}

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
// Using "gemini-1.5-flash-latest" as it's a standard identifier for the official Node.js SDK 
// and supports responseSchema for structured JSON output.
// User examples referenced "gemini-2.0-flash".
const modelInstance = genAI ? genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash-latest" 
}) : null;

// Define the JSON schema for the invoice data
const INVOICE_SCHEMA = {
    type: "OBJECT",
    properties: {
        invoiceId: { type: "STRING", description: "The unique identifier for the invoice (e.g., Invoice No, Document No)." },
        customerId: { type: "STRING", description: "The customer's number or ID, if available.", nullable: true },
        invoiceDate: { type: "STRING", description: "Date the invoice was issued, in YYYY-MM-DD format (e.g., '2024-03-01' from '1. März 2024')." },
        dueDate: { type: "STRING", description: "Date the payment is due, in YYYY-MM-DD format. Infer if possible (e.g., if 'immediate', use invoiceDate).", nullable: true },
        customerDetails: {
            type: "OBJECT",
            description: "Details of the customer being billed.",
            properties: {
                name: { type: "STRING", description: "Full name of the customer or company." },
                address: { type: "STRING", description: "Full billing address of the customer.", nullable: true },
                vatId: { type: "STRING", description: "Customer's VAT ID, if available.", nullable: true },
                contactPerson: { type: "STRING", description: "Contact person at the customer, if available.", nullable: true }
            },
            required: ["name"]
        },
        vendorDetails: {
            type: "OBJECT",
            description: "Details of the vendor issuing the invoice.",
            properties: {
                name: { type: "STRING", description: "Full name of the vendor company." },
                address: { type: "STRING", description: "Full address of the vendor.", nullable: true },
                vatId: { type: "STRING", description: "Vendor's VAT ID.", nullable: true },
                phone: { type: "STRING", description: "Vendor's phone number.", nullable: true },
                email: { type: "STRING", description: "Vendor's email address.", nullable: true },
                website: { type: "STRING", description: "Vendor's website.", nullable: true }
            },
            required: ["name"]
        },
        lineItems: {
            type: "ARRAY",
            description: "List of items or services detailed in the invoice.",
            items: {
                type: "OBJECT",
                properties: {
                    description: { type: "STRING", description: "Description of the item or service." },
                    quantity: { type: "NUMBER", description: "Quantity of the item.", nullable: true },
                    unitPrice: { type: "NUMBER", description: "Price per unit, without VAT/tax (e.g., 130.00 from '130,00 €').", nullable: true },
                    totalAmount: { type: "NUMBER", description: "Total amount for this line item, without VAT/tax.", nullable: true }
                },
                required: ["description"]
            }
        },
        currency: { type: "STRING", description: "Currency code (e.g., EUR, USD) or symbol (€, $) found in the invoice." },
        subTotal: { type: "NUMBER", description: "Total amount before taxes (e.g., 381.12 from 'Total 381,12 €').", nullable: true },
        taxDetails: {
            type: "OBJECT",
            description: "Details about taxes.",
            nullable: true,
            properties: {
                description: { type: "STRING", description: "Description of the tax (e.g., 'VAT 19%').", nullable: true },
                taxRatePercent: { type: "NUMBER", description: "Tax rate applied in percent (e.g., 19 from 'VAT 19%').", nullable: true },
                taxAmount: { type: "NUMBER", description: "Total amount of tax (e.g., 72.41 from 'VAT 19% 72,41 €')." }
            }
        },
        grandTotal: { type: "NUMBER", description: "The final amount due, including all taxes (e.g., 453.53 from 'Gross Amount incl. VAT 453,53 €')." },
        paymentTerms: { type: "STRING", description: "Payment terms (e.g., 'Immediate payment without discount').", nullable: true },
        bankDetails: {
            type: "OBJECT",
            description: "Vendor's bank details for payment.",
            nullable: true,
            properties: {
                iban: { type: "STRING", description: "Vendor's IBAN.", nullable: true },
                bic: { type: "STRING", description: "Vendor's BIC/SWIFT code.", nullable: true },
                bankName: { type: "STRING", description: "Name of the bank.", nullable: true }
            }
        },
        notes: { type: "STRING", description: "Any other relevant notes or comments from the invoice.", nullable: true }
    },
    required: ["invoiceId", "invoiceDate", "customerDetails", "vendorDetails", "lineItems", "currency", "grandTotal"]
};


export async function processPDFWithGemini(pdfBuffer, s3Bucket = null, s3Key = null) {
    if (!modelInstance) { // Check modelInstance
        const errorMessage = "Gemini model is not initialized. Check API Key and SDK setup.";
        console.error(errorMessage);
        throw new Error(errorMessage);
    }

    console.log(`Starting Gemini multimodal processing for PDF (Buffer length: ${pdfBuffer.length}) from s3://${s3Bucket}/${s3Key}`);

    const base64Pdf = pdfBuffer.toString('base64');

    const textPrompt = `
    You are an intelligent document processing AI. Analyze the provided invoice PDF and extract its information.
    Strictly adhere to the provided JSON schema for your response.
    Ensure all monetary values are numbers (e.g., 123.45).
    Parse dates to 'YYYY-MM-DD' format. For example, '1. März 2024' should become '2024-03-01'.
    If a field is not present or cannot be reliably determined, use null if the schema allows it for that field.
    For line items, extract each distinct item with its description, quantity, unit price (before tax), and total amount (before tax).
    The 'subTotal' should be the sum of line item totals before any tax.
    The 'grandTotal' is the final amount payable, including all taxes.
    The 'currency' should be the currency code (e.g., EUR, USD) or symbol used in the invoice.
    `;

    const requestPayload = {
        contents: [
            {
                parts: [
                    { text: textPrompt },
                    {
                        inlineData: {
                            mimeType: 'application/pdf',
                            data: base64Pdf
                        }
                    }
                ]
            }
        ],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: INVOICE_SCHEMA,
            // temperature: 0.2 // Adjust for more deterministic output if needed
        },
        // Optional: Safety settings
        // safetySettings: [
        //   { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        //   { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        //   // ... other categories
        // ]
    };

    try {
        console.log("Sending request to Gemini API (model: gemini-1.5-flash-latest)...");
        const result = await modelInstance.generateContent(requestPayload); // Use modelInstance
        const response = result.response;

        if (!response || !response.candidates || response.candidates.length === 0 || !response.candidates[0].content || !response.candidates[0].content.parts || response.candidates[0].content.parts.length === 0) {
            console.error("Invalid response structure from Gemini:", JSON.stringify(response, null, 2));
            throw new Error("Received an invalid or empty response structure from Gemini API.");
        }
        
        const jsonString = response.text(); 
        console.log("Raw JSON string from Gemini:", jsonString);

        let extractedData;
        try {
            extractedData = JSON.parse(jsonString);
        } catch (parseError) {
            console.error('Error parsing JSON response from Gemini:', parseError.message);
            console.error('Received string that failed to parse:', jsonString);
            throw new Error('Failed to parse JSON response from Gemini AI.');
        }
        
        console.log("Successfully parsed data from Gemini.");

        extractedData.S3Bucket = s3Bucket;
        extractedData.S3Key = s3Key;
        extractedData.processingEngine = 'Gemini-1.5-Flash-Latest'; // Updated to reflect model
        extractedData.extractionTimestamp = new Date().toISOString();

        if (!extractedData.invoiceId) {
            console.warn(`Invoice ID not extracted by Gemini for ${s3Key}. Consider a fallback or review prompt/schema.`);
        }
        
        return extractedData;

    } catch (err) {
        console.error('Error during Gemini API call or processing:', err.message, err.stack);
        if (err.response && err.response.data) { 
            console.error('Gemini API Error Details:', JSON.stringify(err.response.data, null, 2));
        }
        // Check for specific Gemini API block reasons
        if (err.message.includes("SAFETY") || (result && result.response && result.response.promptFeedback && result.response.promptFeedback.blockReason)) {
            console.error("Gemini API request blocked due to safety settings or other policy. Prompt feedback:", result?.response?.promptFeedback);
             throw new Error(`Gemini processing blocked for document ${s3Key || 'unknown'}. Reason: ${result?.response?.promptFeedback?.blockReason || 'Safety Policy'}`);
        }
        throw new Error(`Gemini processing failed for document ${s3Key || 'unknown'}. Error: ${err.message}`);
    }
}


