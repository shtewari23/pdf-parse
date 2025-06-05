
// File: index.js (Main Lambda Handler)
import AWS from 'aws-sdk';
import { processPDFWithGemini } from './pdfProcessorGenAI.js'; // Using the new Gemini multimodal processor
import { saveToDynamo } from './dynamo.js';

const { S3 } = AWS;
const s3 = new S3(); 

export const processEmail = async (event) => {
  console.log("Received S3 event:", JSON.stringify(event, null, 2));

  const processingPromises = event.Records.map(async (record) => {
    const bucket = record.s3.bucket.name;
    // S3 key names can have URL-encoded characters (e.g., spaces as '+').
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    
    let s3ObjectData;
    try {
      console.log(`Processing S3 object: s3://${bucket}/${key}`);

      // 1. Get PDF from S3 as a Buffer
      s3ObjectData = await s3.getObject({ Bucket: bucket, Key: key }).promise();
      const pdfBuffer = s3ObjectData.Body;

      if (!(pdfBuffer instanceof Buffer)) {
          console.error(`S3 object body for ${key} is not a Buffer. Type: ${typeof pdfBuffer}`);
          throw new Error('S3 object body is not a Buffer.');
      }
      console.log(`PDF Buffer loaded for ${key}, size: ${pdfBuffer.length} bytes.`);

      // 2. Call the Gemini processor with the PDF buffer
      const extractedData = await processPDFWithGemini(pdfBuffer, bucket, key);
      
      console.log("Data extracted by Gemini multimodal processor:", JSON.stringify(extractedData, null, 2));
      
      // 3. Prepare data for DynamoDB
      // The `TicketId` for DynamoDB should ideally be the `invoiceId` extracted by Gemini.
      // If your DynamoDB table has a specific primary key named `TicketId`, map it.
      const itemToSave = {
          ...extractedData,
          TicketId: extractedData.invoiceId || `fallback-${key}-${Date.now()}`, // Use extracted invoiceId or a fallback
      };
      // Remove potentially problematic fields if DynamoDB schema is strict
      // delete itemToSave.S3Bucket; 
      // delete itemToSave.S3Key;

      await saveToDynamo(itemToSave);
      console.log(`Data for ${key} (TicketID: ${itemToSave.TicketId}) saved to DynamoDB successfully.`);
      return { success: true, key: key, ticketId: itemToSave.TicketId };

    } catch (error) {
      console.error(`Failed to process S3 object ${key}:`, error.message, error.stack);
      const errorTicketId = `error-${key}-${Date.now()}`;
      try {
        await saveToDynamo({
          TicketId: errorTicketId,
          Status: 'Error-ProcessingFailed',
          S3Bucket: bucket,
          S3Key: key,
          ErrorDetails: error.message,
          ErrorStack: error.stack ? error.stack.substring(0, 1000) : null, // Limit stack trace length
          FileSize: s3ObjectData && s3ObjectData.ContentLength ? s3ObjectData.ContentLength : null,
          FileContentType: s3ObjectData && s3ObjectData.ContentType ? s3ObjectData.ContentType : null,
          Timestamp: new Date().toISOString()
        });
        console.log(`Error record saved to DynamoDB for ${key} with TicketID: ${errorTicketId}`);
      } catch (dbError) {
        console.error(`CRITICAL: Failed to save error record for ${key} to DynamoDB:`, dbError.message);
      }
      return { success: false, key: key, error: error.message, ticketId: errorTicketId };
    }
  });

  try {
    const results = await Promise.all(processingPromises);
    console.log("All records processing finished. Results:", JSON.stringify(results, null, 2));
    
    const failedRecords = results.filter(r => !r.success);
    if (failedRecords.length > 0) {
      console.warn("Some records failed processing:", failedRecords);
    }

    return { statusCode: 200, body: JSON.stringify({ message: 'Processing completed.', results }) };

  } catch (error) {
    console.error('Critical error in processEmail handler:', error.message, error.stack);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Critical error during S3 event processing.',
        error: error.message,
      }),
    };
  }
};