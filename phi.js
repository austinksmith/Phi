require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const { Ollama } = require('ollama');

// Create Discord client instance with required intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
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

// Function to generate a topic using Ollama API
async function generateThreadTopic(content) {
  try {
    const response = await ollamaClient.chat({
      model: 'phi3', // Use the Ollama model
      messages: [{ role: 'user', content: `Summarize this message in a few words to create a funny discussion topic name, keep the characters to less than 100 and do not include additional messages, here is the content to base the message off of: ${content}`}],
    });

    // Check if the response contains a valid message
    if (response && response.message && response.message.content) {
      const summary = response.message.content.trim();
      return summary.length > 0 ? summary : 'discussion';
    }
  } catch (error) {
    handleOllamaError(error);
  }
  return 'discussion'; // Default in case of failure
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
            await thread.send(chunk); // Send response inside the thread
          }
        } else {
          await thread.send(response.message.content); // Send response inside the thread
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

// Check if the message mentions the bot either by username, role ID, or role name
function isBotMentioned(message, botUser, botRoleID, botRoleName) {
  const botMention = `<@${botUser.id}>`;  // Mention format for the bot user
  const roleMention = `<@&${botRoleID}>`; // Mention format for the bot role
  const roleNameMention = botRoleName.toLowerCase(); // Role name in lowercase for easier matching

  // Check if the bot's username or role ID is mentioned, or if the role name is mentioned as plain text
  return (
    message.content.includes(botMention) || 
    message.content.includes(roleMention)
  );
}

// Event listener for when a message is sent in Discord channels
client.on('messageCreate', async (message) => {
  // Ignore messages from bots, including itself
  if (message.author.bot) return;

  console.log(`Received message: ${message.content} from ${message.author.tag}`);

  // Retrieve the bot's role ID and role name dynamically
  const botMember = await message.guild.members.fetch(client.user.id);
  const botRole = botMember.roles.botRole; // Get bot's role (botRole is specific for bot roles)
  const botRoleID = botRole ? botRole.id : null; // Role ID or null if no role found
  const botRoleName = botRole ? botRole.name : ''; // Role name or empty string

  // Check if the bot's username, role ID, or role name is mentioned
  const isMentioned = isBotMentioned(message, client.user, botRoleID, botRoleName);
  const isReplyToBot = message.reference && message.reference.messageId;

  // If a new mention happens and it's not in a thread, create a thread
  if (isMentioned && !message.channel.isThread()) {
    try {
      // Generate thread topic using Ollama API
      const threadTopic = await generateThreadTopic(message.content);
      const threadName = `${threadTopic}`;

      // Create a new thread with a topic-based name and set autoArchiveDuration to 1 hour (60 minutes)
      const thread = await message.startThread({
        name: threadName,
        autoArchiveDuration: 60, // Automatically archive after 1 hour of inactivity
        type: ChannelType.PrivateThread,
      });

      // Initialize thread history if it doesn't exist
      threadHistory[thread.id] = [];

      // Add the user's message to the thread history
      threadHistory[thread.id].push({ role: 'user', content: message.content });

      // Handle the bot response in the thread
      await onMessageInteraction(message, thread);
    } catch (error) {
      console.error('Failed to create a thread:', error);
    }
  } 
  // If the message is in a thread, process it
  else if (message.channel.isThread()) {
    const threadID = message.channel.id;

    // Initialize thread history if it doesn't exist
    if (!threadHistory[threadID]) {
      threadHistory[threadID] = [];
    }

    // Add the new message to the conversation history of the thread
    threadHistory[threadID].push({ role: 'user', content: message.content });

    // Check if the message is a reply to the bot's message
    if (isReplyToBot) {
      try {
        const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
        if (referencedMessage.author.id === client.user.id) {
          // Process the interaction if the reply is to the bot's message
          await onMessageInteraction(message, message.channel);
        }
      } catch (error) {
        console.error('Failed to fetch the referenced message:', error);
      }
    } 
    // Process the interaction if the user mentions the bot
    else if (isMentioned) {
      await onMessageInteraction(message, message.channel);
    }
  }
});

// Run the Discord bot
client.login(process.env.DISCORD_TOKEN);
