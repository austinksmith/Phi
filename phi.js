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
      messages: [{ role: 'assistant', content: message.content }],
    });
    console.log(response);
    if (response && response.message) {
      if (response.message.content) {
        await message.reply(response.message.content);
      } else {
        await message.reply('No suitable message was returned from Ollama API.');
      }
    } else {
      await message.reply('No messages were returned from Ollama API.');
    }
  } catch (error) {
    // Handle errors with Ollama API
    handleOllamaError(error);
    await message.reply(error);
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
  if (message.content.startsWith(botMention)) {
    await onMessageInteraction(message);
  }
});

// Run the Discord bot
client.login(process.env.DISCORD_TOKEN);
