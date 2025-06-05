 import AWS from 'aws-sdk';
import { simpleParser } from 'mailparser'; // Needs 'mailparser' dependency

const s3 = new AWS.S3();
// Environment variable for the S3 bucket where attachments will be stored.
// This bucket should be configured to trigger your existing 'processEmail' Lambda.
const ATTACHMENT_BUCKET_NAME = process.env.ATTACHMENT_BUCKET_NAME || 'email-attachments-bucket-dev-1749037511789'; 

if (!ATTACHMENT_BUCKET_NAME) {
    console.error("Error: ATTACHMENT_BUCKET_NAME environment variable is not set.");
    // In a real scenario, you might want to throw an error or handle this more gracefully.
}

export const handler = async (event) => {
    console.log("SES Email Processor event received:", JSON.stringify(event, null, 2));

    if (!ATTACHMENT_BUCKET_NAME) {
        console.error("Attachment bucket name is not configured. Exiting.");
        return { statusCode: 500, body: "Server configuration error: Attachment bucket not set." };
    }

    const record = event.Records[0]; // SES usually sends one record per event
    if (!record || !record.ses || !record.ses.mail || !record.ses.mail.messageId) {
        console.error("Invalid SES event structure:", JSON.stringify(record, null, 2));
        return { statusCode: 400, body: "Invalid SES event." };
    }

    const messageId = record.ses.mail.messageId;
    console.log(`Processing email with Message ID: ${messageId}`);

    // Get the raw email from S3 (SES can be configured to save raw emails to S3 first)
    // OR, if SES invokes Lambda directly with the email content (less common for large emails),
    // you might get it differently. This example assumes SES is configured to save the
    // raw email to an S3 bucket, and *that* S3 event (for the raw email) triggers this Lambda.
    // A more common pattern is SES > S3 (raw email) > Lambda (this one) > S3 (attachments) > Lambda (Gemini processor)

    // For this example, let's assume SES is configured to trigger this Lambda *directly*
    // and the raw email content is accessible via an S3 object key provided in the SES event.
    // This requires SES to be configured with an S3 action that saves the email, AND
    // that S3 action's notification ALSO triggers this Lambda.
    // A simpler SES setup: SES Rule -> Lambda Action (this Lambda).
    // In that case, the email content is not directly in the event.
    // The SES event for Lambda action contains `event.Records[0].ses.mail` with headers and common headers.
    // To get the full raw email, SES needs to be configured to also save to S3, and this Lambda
    // would fetch it using the messageId.

    // Let's assume a common pattern: SES Rule -> S3 Action (saves raw email) -> S3 Event -> This Lambda
    // The 'event' here would be an S3 event, not a direct SES event.
    // If SES triggers this Lambda directly (SES Rule -> Lambda Action), the raw email isn't in the event.
    // You'd typically have SES save to S3 first, then this Lambda is triggered by that S3 Put.

    // **Simplification for this example:**
    // Assuming this Lambda is triggered by an S3 event after SES has saved the *raw email* to an S3 bucket.
    // The `event.Records[0].s3.object.key` would be the key to the raw email .eml file.
    // And `event.Records[0].s3.bucket.name` would be the bucket where SES saved it.

    if (!record.s3 || !record.s3.bucket || !record.s3.object) {
        console.error("This Lambda expects to be triggered by an S3 event containing the raw email from SES.");
        console.log("If SES triggers this Lambda directly, the approach to get raw email content needs to change.");
        return { statusCode: 400, body: "Lambda not triggered by expected S3 event for raw email." };
    }
    
    const sourceBucket = record.s3.bucket.name;
    const sourceKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' ')); // Key for the raw .eml file

    console.log(`Fetching raw email from s3://${sourceBucket}/${sourceKey}`);

    try {
        const s3Object = await s3.getObject({ Bucket: sourceBucket, Key: sourceKey }).promise();
        const rawEmail = s3Object.Body.toString('utf-8'); // Or 'binary' if issues arise

        const parsedEmail = await simpleParser(rawEmail);

        console.log(`Email Subject: ${parsedEmail.subject}`);
        console.log(`From: ${parsedEmail.from.text}`);
        console.log(`To: ${parsedEmail.to.text}`);
        console.log(`Found ${parsedEmail.attachments.length} attachment(s).`);

        const uploadPromises = [];

        for (const attachment of parsedEmail.attachments) {
            // Process only PDF attachments
            if (attachment.contentType === 'application/pdf' || (attachment.filename && attachment.filename.toLowerCase().endsWith('.pdf'))) {
                const filename = attachment.filename || `attachment-${messageId}-${Date.now()}.pdf`;
                // Sanitize filename if necessary for S3 key
                const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '_'); 
                const attachmentKey = `attachments/${messageId}/${safeFilename}`; // Store in a subfolder

                console.log(`Uploading PDF attachment: ${filename} to s3://${ATTACHMENT_BUCKET_NAME}/${attachmentKey}`);

                uploadPromises.push(
                    s3.putObject({
                        Bucket: ATTACHMENT_BUCKET_NAME,
                        Key: attachmentKey,
                        Body: attachment.content, // mailparser provides content as a Buffer
                        ContentType: attachment.contentType,
                    }).promise()
                );
            } else {
                console.log(`Skipping non-PDF attachment: ${attachment.filename} (Type: ${attachment.contentType})`);
            }
        }

        if (uploadPromises.length > 0) {
            await Promise.all(uploadPromises);
            console.log(`${uploadPromises.length} PDF attachment(s) uploaded successfully to ${ATTACHMENT_BUCKET_NAME}.`);
        } else {
            console.log("No PDF attachments found or uploaded.");
        }

        return { statusCode: 200, body: `Successfully processed email ${messageId}. ${uploadPromises.length} PDF(s) uploaded.` };

    } catch (error) {
        console.error(`Error processing email ${messageId} from s3://${sourceBucket}/${sourceKey}:`, error.message, error.stack);
        return { statusCode: 500, body: `Error processing email: ${error.message}` };
    }
};