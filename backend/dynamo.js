// File: dynamo.js
// (This file remains largely the same as your previous version)
// Ensure it handles the new fields from the Gemini output if your table structure changed.
import AWS from 'aws-sdk';

const { DynamoDB } = AWS;
const db = new DynamoDB.DocumentClient();
const tableName = process.env.INVOICE_TABLE_NAME || 'InvoiceTable';

export async function saveToDynamo(data) {
  const params = {
    TableName: tableName,
    Item: data, // The data object from Gemini will be saved.
  };
  console.log(`Saving to DynamoDB. Table: ${tableName}, Item Keys: ${Object.keys(data).join(', ')}`);
  try {
    await db.put(params).promise();
    console.log(`Successfully saved item with TicketId/invoiceId: ${data.TicketId || data.invoiceId} to DynamoDB.`);
    return { success: true, id: data.TicketId || data.invoiceId };
  } catch (error) {
    console.error("Error saving to DynamoDB:", error.message, error.stack);
    console.error("DynamoDB params:", JSON.stringify(params, null, 2));
    throw error; 
  }
}


