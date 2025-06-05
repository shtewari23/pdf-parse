
// ----------------------------------------------------------------------------------
// NEW FILE: getInvoiceApiHandler.js - Lambda function for API Gateway to fetch data
// ----------------------------------------------------------------------------------
import AWS from 'aws-sdk';

const { DynamoDB } = AWS;
const db = new DynamoDB.DocumentClient();
const tableName = process.env.INVOICE_TABLE_NAME || 'InvoiceTable-dev1'; // Same table name

// Helper function to create API Gateway compatible response
const createResponse = (statusCode, body) => {
    return {
        statusCode: statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*', // Allow all origins (for development)
            'Access-Control-Allow-Methods': 'GET,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'
        },
        body: JSON.stringify(body),
    };
};

export const handler = async (event) => {
    console.log("API Gateway event received:", JSON.stringify(event, null, 2));

    const httpMethod = event.httpMethod;
    const path = event.path;

    if (httpMethod === "OPTIONS") {
        // Handle CORS preflight requests
        return createResponse(200, { message: "CORS preflight successful" });
    }

    if (httpMethod !== "GET") {
        return createResponse(405, { error: `Unsupported method: ${httpMethod}` });
    }

    try {
        // Example: GET /invoices/{ticketId}
        if (event.pathParameters && event.pathParameters.ticketId) {
            const ticketId = event.pathParameters.ticketId;
            console.log(`Fetching invoice by TicketId: ${ticketId}`);
            
            const params = {
                TableName: tableName,
                Key: {
                    'TicketId': ticketId,
                },
            };
            const data = await db.get(params).promise();

            if (data.Item) {
                return createResponse(200, data.Item);
            } else {
                return createResponse(404, { error: `Invoice with TicketId ${ticketId} not found.` });
            }
        } 
        // Example: GET /invoices (lists all invoices - use with caution in production without pagination)
        // You might use query parameters to control listing, e.g., /invoices?status=processed or /invoices?dateRange=...
        else if (path === '/invoices' || (event.queryStringParameters && event.queryStringParameters.list === 'all')) {
            console.log("Fetching all invoices (scan operation - consider pagination for production)...");
            // A scan operation can be expensive on large tables.
            // For production, implement pagination using `ExclusiveStartKey` and `Limit`.
            // Also, consider using Global Secondary Indexes (GSIs) for more efficient querying if needed.
            const params = {
                TableName: tableName,
                // Limit: 20, // Example: Add a limit for safety
                // ExclusiveStartKey: event.queryStringParameters?.lastKey ? JSON.parse(decodeURIComponent(event.queryStringParameters.lastKey)) : undefined
            };
            const data = await db.scan(params).promise();
            
            // const responseBody = {
            //     items: data.Items,
            //     count: data.Count,
            //     scannedCount: data.ScannedCount,
            //     lastKey: data.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(data.LastEvaluatedKey)) : null
            // };
            // return createResponse(200, responseBody);
            return createResponse(200, { items: data.Items, count: data.Count, message: "Full scan executed. Implement pagination for production." });

        } else {
            return createResponse(400, { error: "Invalid request path or parameters. Try /invoices/{ticketId} or /invoices?list=all" });
        }
    } catch (error) {
        console.error("Error processing API request:", error.message, error.stack);
        return createResponse(500, { error: "Internal server error.", details: error.message });
    }
};

/*
API Gateway Setup (Conceptual):

1. Create a new API Gateway (e.g., HTTP API or REST API).
   - HTTP APIs are simpler and more cost-effective for many use cases.
   - REST APIs offer more features like request validation, custom authorizers, etc.

2. Define Routes/Resources:
   - For GET /invoices/{ticketId}:
     - Create a resource like `/invoices/{ticketId}`.
     - Create a GET method for this resource.
   - For GET /invoices (to list all):
     - Create a resource like `/invoices`.
     - Create a GET method for this resource.

3. Integration:
   - For each GET method, configure an AWS Lambda integration.
   - Point the integration to this `getInvoiceApiHandler` Lambda function.
   - Ensure API Gateway has permissions to invoke the Lambda function.
     (This is often handled automatically when creating the integration via the console,
      or you'll need to add a resource-based policy to the Lambda).

4. Request Mapping (for REST API, if needed):
   - For `/invoices/{ticketId}`, API Gateway automatically maps the path parameter `ticketId`
     into the `event.pathParameters.ticketId` object for the Lambda.
   - For query parameters like `?list=all`, they appear in `event.queryStringParameters`.

5. CORS (Cross-Origin Resource Sharing):
   - If your API will be called from a web browser hosted on a different domain,
     you need to enable CORS.
   - The `createResponse` helper includes basic CORS headers.
   - For HTTP APIs, CORS can be configured directly in the API Gateway settings.
   - For REST APIs, you can configure CORS per-resource/method or enable it via OPTIONS method handling.

6. Deployment:
   - Deploy your API Gateway to a stage (e.g., `dev`, `prod`).
   - You will get an Invoke URL for your API.

Example Invoke URLs:
- `https://<api-id>.execute-api.<region>.amazonaws.com/<stage>/invoices/some-ticket-id-123`
- `https://<api-id>.execute-api.<region>.amazonaws.com/<stage>/invoices?list=all`

Security:
- Consider adding authentication/authorization to your API (e.g., IAM, Cognito User Pools, Lambda Authorizers).
  The current example is open.
*/