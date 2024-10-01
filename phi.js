require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const { Ollama } = require('ollama');
const sqlite3 = require('sqlite3').verbose();  // SQLite3 library

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

// Initialize SQLite database
const db = new sqlite3.Database('./message_history.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database.');
    db.run(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL
    )`);
  }
});

// Function to save message to SQLite
function saveMessageToDB(threadId, role, content) {
  db.run(`INSERT INTO messages (thread_id, role, content) VALUES (?, ?, ?)`, [threadId, role, content], function(err) {
    if (err) {
      console.error('Failed to save message:', err);
    }
  });
}

// Function to retrieve message history from SQLite for a specific thread
function getMessageHistoryFromDB(threadId) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT role, content FROM messages WHERE thread_id = ? ORDER BY id ASC`, [threadId], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        const history = rows.map(row => ({
          role: row.role,
          content: row.content,
        }));
        resolve(history);
      }
    });
  });
}

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
      model: 'phi3',
      messages: [{ role: 'user', content: `Summarize this message in a few words to create a funny discussion topic name, here is the content: ${content}`}],
    });

    if (response && response.message && response.message.content) {
      return response.message.content.trim();
    }
  } catch (error) {
    handleOllamaError(error);
  }
  return 'discussion';
}

// Function to handle messages from Discord threads
async function onMessageInteraction(message, thread) {
  try {
    await thread.sendTyping();

    // Get the history for the thread from SQLite
    const history = await getMessageHistoryFromDB(thread.id);

    // Get the response from Ollama API
    const response = await ollamaClient.chat({
      model: 'phi3',
      messages: history,
    });

    if (response && response.message) {
      if (response.message.content) {
        // Save the bot's response to the database
        saveMessageToDB(thread.id, 'assistant', response.message.content);

        // Check if the response is over 2000 characters
        if (response.message.content.length > 2000) {
          const chunks = splitMessage(response.message.content, 2000);
          for (const chunk of chunks) {
            await thread.send(chunk);
          }
        } else {
          await thread.send(response.message.content);
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

// Check if the message mentions the bot
function isBotMentioned(message, botUser, botRoleID, botRoleName) {
  const botMention = `<@${botUser.id}>`;
  const roleMention = `<@&${botRoleID}>`;

  return message.content.includes(botMention) || message.content.includes(roleMention);
}

// Event listener for when a message is sent in Discord channels
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  console.log(`Received message: ${message.content} from ${message.author.tag}`);

  const botMember = await message.guild.members.fetch(client.user.id);
  const botRole = botMember.roles.botRole;
  const botRoleID = botRole ? botRole.id : null;
  const botRoleName = botRole ? botRole.name : '';

  const isMentioned = isBotMentioned(message, client.user, botRoleID, botRoleName);
  const isReplyToBot = message.reference && message.reference.messageId;

  if (isMentioned && !message.channel.isThread()) {
    try {
      const threadTopic = await generateThreadTopic(message.content);
      const thread = await message.startThread({
        name: threadTopic,
        autoArchiveDuration: 60,
        type: ChannelType.PrivateThread,
      });

      // Save the user's message to the database
      saveMessageToDB(thread.id, 'user', message.content);

      // Handle the bot response in the thread
      await onMessageInteraction(message, thread);
    } catch (error) {
      console.error('Failed to create a thread:', error);
    }
  } else if (message.channel.isThread()) {
    const threadID = message.channel.id;

    // Save the user's message to the database
    saveMessageToDB(threadID, 'user', message.content);

    if (isReplyToBot) {
      try {
        const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
        if (referencedMessage.author.id === client.user.id) {
          await onMessageInteraction(message, message.channel);
        }
      } catch (error) {
        console.error('Failed to fetch the referenced message:', error);
      }
    } else if (isMentioned) {
      await onMessageInteraction(message, message.channel);
    }
  }
});

// Run the Discord bot
client.login(process.env.DISCORD_TOKEN);
