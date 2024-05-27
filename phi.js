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

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

// Function to handle errors with Ollama API
function handleOllamaError(error) {
  console.error('An error occurred with the Ollama API:', error);
}

// Function to handle messages from Discord channels
async function onMessageInteraction(message) {
  try {
    // Get the response from Ollama API
    const response = await ollamaClient.chat({
      model: 'phi3',
      messages: [{ role: 'user', content: message.content }],
    });
    console.log("RESPONSE! ", response);
    if (response && response.message) {
      if (response.message.content) {
        // Check if the response is over 2000 characters
        if (response.message.content.length > 2000) {
          await message.reply('The response from Ollama API is too long to be sent on Discord.');
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
  const isMentioned = message.content.startsWith(botMention);
  const isReplyToBot = message.reference && message.reference.messageId;

  if (isMentioned || isReplyToBot) {
    // If the message is a reply, fetch the original message to check if it was sent by the bot
    if (isReplyToBot) {
      try {
        const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
        if (referencedMessage.author.id !== client.user.id) {
          return;
        }
      } catch (error) {
        console.error('Failed to fetch the referenced message:', error);
        return;
      }
    }

    await onMessageInteraction(message);
  }
});

// Run the Discord bot
client.login(process.env.DISCORD_TOKEN);
