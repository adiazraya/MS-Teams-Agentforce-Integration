const restify = require('restify');
const axios = require('axios');
//const { CloudAdapter, ConfigurationServiceClientCredentialFactory, ConfigurationBotFrameworkAuthentication } = require('botbuilder');
require('dotenv').config();
const { CloudAdapter, ConfigurationServiceClientCredentialFactory, ConfigurationBotFrameworkAuthentication } = require('botbuilder');

const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
    MicrosoftAppId: process.env.BOT_ID,
    MicrosoftAppPassword: process.env.BOT_PASSWORD
});
console.log(credentialsFactory);
const botAuth = new ConfigurationBotFrameworkAuthentication({}, credentialsFactory);
console.log(botAuth);
const adapter = new CloudAdapter(botAuth);
console.log(adapter);
// Error handling
adapter.onTurnError = async (context, error) => {
    console.error(`[ERROR] ${error}`);
    await context.sendActivity("Oops! Something went wrong.");
};

// Function to get Salesforce access token
async function getSalesforceToken() {
    try {
        const response = await axios.post(process.env.SF_TOKEN_URL, new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: process.env.SF_CLIENT_ID,
            client_secret: process.env.SF_CLIENT_SECRET
        }));
        console.log("🔑 Salesforce Access Token Retrieved");
        return response.data.access_token;
    } catch (error) {
        console.error("❌ Error getting Salesforce token:", error.response?.data || error.message);
        throw new Error("Failed to get Salesforce token.");
    }
}

// Function to create a session with Salesforce Einstein AI
async function createEinsteinSession(accessToken) {
    try {
        const response = await axios.post(process.env.SF_SESSION_URL, {
            externalSessionKey: "teams-chat-session",
            instanceConfig: { endpoint: process.env.SF_INSTANCE_URL },
            streamingCapabilities: { chunkTypes: ["Text"] },
            bypassUser: true
        }, { headers: { Authorization: `Bearer ${accessToken}` } });

        console.log("✅ Einstein AI Session Created:", response.data.sessionId);
        return response.data.sessionId;
    } catch (error) {
        console.error("❌ Error creating Einstein AI session:", error.response?.data || error.message);
        throw new Error("Failed to create Einstein AI session.");
    }
}

// Function to send messages to Einstein AI
async function sendEinsteinMessage(accessToken, sessionId, userMessage) {
    try {
        const response = await axios.post(`${process.env.SF_MESSAGE_URL}/${sessionId}/messages`, {
            message: { sequenceId: Date.now(), type: "Text", text: userMessage },
            variables: []
        }, { headers: { Authorization: `Bearer ${accessToken}` } });

        console.log("📩 Message Sent to Einstein AI:", userMessage);
        return response.data.messages[0].message; // Return chatbot's response
    } catch (error) {
        console.error("❌ Error sending message to Einstein AI:", error.response?.data || error.message);
        throw new Error("Failed to send message to Einstein AI.");
    }
}

// Bot logic to process messages from Teams users
const botLogic = async (context) => {
    if (context.activity.type === 'message') {
        const userMessage = context.activity.text;
        await context.sendActivity("⏳ Processing your request...");

        try {
            const accessToken = await getSalesforceToken();
            const sessionId = await createEinsteinSession(accessToken);
            const responseMessage = await sendEinsteinMessage(accessToken, sessionId, userMessage);

            await context.sendActivity(responseMessage);
        } catch (error) {
            await context.sendActivity("❌ Error communicating with Salesforce Einstein AI.");
        }
    }
};

// Create API server
const server = restify.createServer();
server.use(restify.plugins.bodyParser());

// Endpoint for Teams bot
server.post('/api/messages', async (req, res) => {
    await adapter.process(req, res, botLogic);
});
adapter.onTurnError = async (context, error) => {
    console.error(`[ERROR] ${error}`);
    await context.sendActivity("Oops! Something went wrong.");
};
//console.log(`✅ Bot started. Listening on port ${process.env.PORT || 3978}`);
// Start server
server.listen(process.env.PORT || 3978, () => {
   console.log(`🚀 Bot is running on port ${server.address().port}`);
});