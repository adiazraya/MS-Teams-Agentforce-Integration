const restify = require('restify');
const axios = require('axios');
require('dotenv').config();
const { CloudAdapter, ConfigurationServiceClientCredentialFactory, ConfigurationBotFrameworkAuthentication } = require('botbuilder');

const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
    MicrosoftAppId: process.env.BOT_ID,
    MicrosoftAppPassword: process.env.BOT_PASSWORD
});
const botAuth = new ConfigurationBotFrameworkAuthentication({}, credentialsFactory);
const adapter = new CloudAdapter(botAuth);

adapter.onTurnError = async (context, error) => {
    console.error(`[ERROR] ${error}`);
    await context.sendActivity("Oops! Something went wrong.");
};

async function getSalesforceToken() {
    try {
        const response = await axios.post(process.env.SF_TOKEN_URL, new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: process.env.SF_CLIENT_ID,
            client_secret: process.env.SF_CLIENT_SECRET
        }));
        return response.data.access_token;
    } catch (error) {
        console.error("❌ Error getting Salesforce token:", error.response?.data || error.message);
        throw new Error("Failed to get Salesforce token.");
    }
}

async function createEinsteinSession(accessToken) {
    try {
        const response = await axios.post(process.env.SF_SESSION_URL, {
            externalSessionKey: "teams-chat-session",
            instanceConfig: { endpoint: process.env.SF_INSTANCE_URL },
            streamingCapabilities: { chunkTypes: ["Text"] },
            bypassUser: true
        }, { headers: { Authorization: `Bearer ${accessToken}` } });
        return response.data.sessionId;
    } catch (error) {
        console.error("❌ Error creating Einstein AI session:", error.response?.data || error.message);
        throw new Error("Failed to create Einstein AI session.");
    }
}

async function sendEinsteinMessage(accessToken, sessionId, userMessage) {
    try {
        const response = await axios.post(`${process.env.SF_MESSAGE_URL}/${sessionId}/messages`, {
            message: { sequenceId: Date.now(), type: "Text", text: userMessage },
            variables: []
        }, { headers: { Authorization: `Bearer ${accessToken}` } });
        return response.data.messages[0].message;
    } catch (error) {
        console.error("❌ Error sending message to Einstein AI:", error.response?.data || error.message);
        throw new Error("Failed to send message to Einstein AI.");
    }
}

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

const server = restify.createServer();
server.use(restify.plugins.bodyParser());

server.post('/api/messages', async (req, res) => {
    /* Microsoft teams does not implement Server Sent Events. If it would, the following sentence should be enough
     ******    await adapter.process(req, res, botLogic);  *******
    .... but as it does not.... we need the following code:
    */
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const botLogic2 = async (context) => {
        if (context.activity.type === 'message') {
            const userMessage = context.activity.text;
            res.write(`data: "⏳ Processing your request..."\n\n`);

            try {
                const accessToken = await getSalesforceToken();
                res.write(`data: "🔑 Salesforce token retrieved"\n\n`);

                const sessionId = await createEinsteinSession(accessToken);
                res.write(`data: "✅ Einstein AI session started"\n\n`);

                const streamUrl = `${process.env.SF_MESSAGE_URL}/${sessionId}/messages/stream`;

                const response = await axios({
                    method: 'post',
                    url: streamUrl,
                    headers: {
                        'Accept': 'text/event-stream',
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    data: {
                        message: { sequenceId: Date.now(), type: "Text", text: userMessage },
                        variables: []
                    },
                    responseType: 'stream'
                });

                response.data.on('data', (chunk) => {
                    res.write(`data: ${chunk}\n\n`);
                });

                response.data.on('end', () => {
                    res.write("event: done\n\n");
                    res.end();
                });

            } catch (error) {
                res.write(`data: "❌ Error: ${JSON.stringify(error.response?.data || error.message)}"\n\n`);
                res.end();
            }
        }
    };

    await adapter.process(req, res, botLogic2);
});


server.get('/api/messages/stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    try {
        const accessToken = await getSalesforceToken();
        const sessionId = await createEinsteinSession(accessToken);
        const streamUrl = `${process.env.SF_MESSAGE_URL}/${sessionId}/messages/stream`;
        
        const response = await axios({
            method: 'post',
            url: streamUrl,
            headers: {
                'Accept': 'text/event-stream',
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            data: {
                message: { sequenceId: Date.now(), type: "Text", text: req.query.message },
                variables: []
            },
            responseType: 'stream'
        });

        response.data.on('data', (chunk) => {
            res.write(`data: ${chunk}\n\n`);
        });

        response.data.on('end', () => {
            res.write("event: done\n\n");
            res.end();
        });
    } catch (error) {
        res.write(`event: error\ndata: ${JSON.stringify(error.response?.data || error.message)}\n\n`);
        res.end();
    }
});

server.listen(process.env.PORT || 3978, () => {
   console.log(`🚀 Agentforce is running on port ${server.address().port}`);
});
