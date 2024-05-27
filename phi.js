require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
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

// Store conversation history for each user in each channel
const conversationHistory = {};

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`Connected to ${process.env.OLLAMA_API_URL}`);
});

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

// Function to handle messages from Discord channels
async function onMessageInteraction(message, userHistory) {
  try {
    // Show typing indicator
    await message.channel.sendTyping();

    // Get the response from Ollama API
    const response = await ollamaClient.chat({
      model: 'phi3',
      messages: userHistory,
    });

    if (response && response.message) {
      if (response.message.content) {
        // Add the bot response to the conversation history
        userHistory.push({ role: 'assistant', content: response.message.content });

        // Check if the response is over 2000 characters
        if (response.message.content.length > 2000) {
          // Split the response into chunks of 2000 characters
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

  // Check if the bot is mentioned in the message or if the message is a reply to the bot
  const botMention = `<@${client.user.id}>`;
  const isMentioned = message.content.includes(botMention);
  const isReplyToBot = message.reference && message.reference.messageId;

  // Initialize conversation history for the user in the channel if it doesn't exist
  if (!conversationHistory[message.channel.id]) {
    conversationHistory[message.channel.id] = {};
  }
  if (!conversationHistory[message.channel.id][message.author.id]) {
    conversationHistory[message.channel.id][message.author.id] = [];
  }

  const userHistory = conversationHistory[message.channel.id][message.author.id];

  if (message.content.trim() === '/reset') {
    // Reset the conversation history for the user
    userHistory.length = 0; // Clear the array without losing reference
    await message.reply('Conversation history has been reset.');
  } else if (isMentioned) {
    // Reset the conversation history for new mentions
    userHistory.length = 0; // Clear the array without losing reference
    userHistory.push({ role: 'user', content: message.content });
    await onMessageInteraction(message, userHistory);
  } else if (isReplyToBot) {
    try {
      const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
      if (referencedMessage.author.id === client.user.id) {
        // Add the new user message to the conversation history
        userHistory.push({ role: 'user', content: message.content });
        await onMessageInteraction(message, userHistory);
      }
    } catch (error) {
      console.error('Failed to fetch the referenced message:', error);
    }
  }
});

// Run the Discord bot
client.login(process.env.DISCORD_TOKEN);
