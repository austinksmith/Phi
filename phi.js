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
  // Split the message into words and filter out common words
  const commonWords = ['the', 'is', 'in', 'and', 'a', 'an', 'on', 'to', 'of', 'for', 'with', 'as', 'it', 'at'];
  const words = message.split(' ')
    .filter(word => word.length > 2 && !commonWords.includes(word.toLowerCase())); // Filter words longer than 2 chars

  // If there are no good keywords, default to 'discussion'
  if (words.length === 0) return 'discussion';

  // Join a few keywords together to form the thread name (up to 3 words)
  return words.slice(0, 3).join(' ');
}

// Function to handle messages from Discord threads
async function onMessageInteraction(message, threadID) {
  try {
    // Show typing indicator
    await message.channel.sendTyping();

    // Get the history for the thread
    const history = threadHistory[threadID];

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
            await message.reply(chunk);
          }
        } else {
          await message.reply(response.message.content);
        }
      } else {
        await message.reply('No suitable message was returned from Ollama API.');
      }
    } else {
      await message.reply('No messages were returned from Ollama API.');
    }
  } catch (error) {
    // Handle errors with Ollama API
    handleOllamaError(error);
    await message.reply('An error occurred while processing your request.');
  }
}

// Event listener for when a message is sent in Discord channels
client.on('messageCreate', async (message) => {
  // Ignore messages from bots, including itself
  if (message.author.bot) return;

  // Log incoming messages
  console.log(`Received message: ${message.content} from ${message.author.tag}`);

  // Check if the bot is mentioned in the message
  const botMention = `<@${client.user.id}>`;
  const isMentioned = message.content.includes(botMention);

  // When the bot is mentioned, create a thread if one does not already exist
  if (isMentioned) {
    try {
      // Extract keywords from the message for the thread name
      const threadTopic = extractKeywords(message.content);
      const threadName = `Discussion: ${threadTopic}`;

      // Create a new thread with a topic-based name
      const thread = await message.startThread({
        name: threadName,
        autoArchiveDuration: 60, // Automatically archive the thread after 60 minutes of inactivity
        type: ChannelType.PrivateThread,
      });

      // Initialize thread history if it doesn't exist
      if (!threadHistory[thread.id]) {
        threadHistory[thread.id] = [];
      }

      // Add the user's message to the thread history
      threadHistory[thread.id].push({ role: 'user', content: message.content });

      // Handle the bot response in the thread
      await onMessageInteraction(message, thread.id);
    } catch (error) {
      console.error('Failed to create a thread:', error);
    }
  } else if (message.channel.type === ChannelType.PrivateThread) {
    // Handle messages within an existing thread
    const threadID = message.channel.id;

    // Check if the thread history exists
    if (!threadHistory[threadID]) {
      threadHistory[threadID] = [];
    }

    // Add the new user message to the conversation history
    threadHistory[threadID].push({ role: 'user', content: message.content });

    // Handle the bot response in the thread
    await onMessageInteraction(message, threadID);
  }
});

// Run the Discord bot
client.login(process.env.DISCORD_TOKEN);
