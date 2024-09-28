require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const { Ollama } = require('ollama');

// Create Discord client instance with required intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Create an instance of the Ollama client with the local URL
const ollamaClient = new Ollama({ apiUrl: process.env.OLLAMA_API_URL });

// Store conversation history for each thread
const threadHistory = {};

// Function to handle errors with Ollama API
function handleOllamaError(error) {
  console.error('An error occurred with the Ollama API:', error);
}

// Helper function to split a message into chunks of a specified size
function splitMessage(message, chunkSize) {
  const chunks = [];
  for (let i = 0; i < message.length; i += chunkSize) {
    chunks.push(message.slice(i, i + chunkSize));
  }
  return chunks;
}

// Simple function to extract keywords from a sentence (basic keyword extraction)
function extractKeywords(message) {
  const commonWords = ['the', 'is', 'in', 'and', 'a', 'an', 'on', 'to', 'of', 'for', 'with', 'as', 'it', 'at'];
  const words = message.split(' ')
    .filter(word => word.length > 2 && !commonWords.includes(word.toLowerCase()));

  if (words.length === 0) return 'discussion';
  return words.slice(0, 3).join(' ');
}

// Function to handle messages from Discord threads
async function onMessageInteraction(message, thread) {
  try {
    await thread.sendTyping();

    // Get the history for the thread
    const history = threadHistory[thread.id];

    // Get the response from Ollama API
    const response = await ollamaClient.chat({
      model: 'phi3',
      messages: history,
    });

    if (response && response.message) {
      if (response.message.content) {
        // Add the bot response to the conversation history
        history.push({ role: 'assistant', content: response.message.content });

        // Check if the response is over 2000 characters
        if (response.message.content.length > 2000) {
          const chunks = splitMessage(response.message.content, 2000);
          for (const chunk of chunks) {
            await thread.send(chunk);  // Send response inside the thread
          }
        } else {
          await thread.send(response.message.content);  // Send response inside the thread
        }
      } else {
        await thread.send('No suitable message was returned from Ollama API.');
      }
    } else {
      await thread.send('No messages were returned from Ollama API.');
    }
  } catch (error) {
    handleOllamaError(error);
    await thread.send('An error occurred while processing your request.');
  }
}

// Event listener for when a message is sent in Discord channels
client.on('messageCreate', async (message) => {
  // Ignore messages from bots, including itself
  if (message.author.bot) return;

  console.log(`Received message: ${message.content} from ${message.author.tag}`);

  const botMention = `<@${client.user.id}>`;  // Get the bot's ID from the client object
  const isMentioned = message.content.includes(botMention);

  // If a new mention happens and it's not in a thread, create a thread
  if (isMentioned && !message.channel.isThread()) {
    try {
      const threadTopic = extractKeywords(message.content);
      const threadName = `Discussion: ${threadTopic}`;

      // Create a new thread with a topic-based name
      const thread = await message.startThread({
        name: threadName,
        autoArchiveDuration: 60,
        type: ChannelType.PrivateThread,
      });

      // Initialize thread history if it doesn't exist
      if (!threadHistory[thread.id]) {
        threadHistory[thread.id] = [];
      }

      // Add the user's message to the thread history
      threadHistory[thread.id].push({ role: 'user', content: message.content });

      // Handle the bot response in the thread
      await onMessageInteraction(message, thread);
    } catch (error) {
      console.error('Failed to create a thread:', error);
    }
  } 
  // If the message is in a thread and the bot is mentioned, continue the conversation within that thread
  else if (message.channel.isThread()) {
    const threadID = message.channel.id;

    // Initialize thread history if it doesn't exist
    if (!threadHistory[threadID]) {
      threadHistory[threadID] = [];
    }

    // Check if the message is a reply to the bot
    if (isMentioned || (message.reference && message.reference.messageId)) {
      // Add the new message to the conversation history of the thread
      threadHistory[threadID].push({ role: 'user', content: message.content });

      // Process and respond in the same thread
      await onMessageInteraction(message, message.channel);
    }
  }
});

// Run the Discord bot
client.login(process.env.DISCORD_TOKEN);
