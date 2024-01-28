require('dotenv').config();
const fetch = require('node-fetch');
const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  TextInputBuilder,
  TextInputStyle,
  ModalBuilder,
} = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { writeFile, unlink } = require('fs/promises');
const sharp = require('sharp');
const pdf = require('pdf-parse');
const cheerio = require('cheerio');
const { YoutubeTranscript } = require('youtube-transcript');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const chatHistories = {};
const activeUsersInChannels = {};
const customInstructions = {};
const activeRequests = new Set();

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
  try {
    // Prevent the bot from responding to itself
    if (message.author.bot) return;

    // Determine if the bot is active for the channel, mentioned, or in a DM
    const isDM = message.channel.type === ChannelType.DM;
    const isBotMentioned = message.mentions.users.has(client.user.id);
    const isUserActiveInChannel = activeUsersInChannels[message.channelId] && activeUsersInChannels[message.channelId][message.author.id] || isDM;
  
    if (isUserActiveInChannel || (isBotMentioned && !isDM)) {
      if (activeRequests.has(message.author.id)) {
        await message.reply('> `Please wait until your previous action is complete.`');
        return;
      } else if (message.attachments.size > 0 && hasTextFileAttachments(message)) {
        await handleTextFileMessage(message);
      } else {
        await handleTextMessage(message);
      }
    }
  } catch (error) {
    console.error('Error handling a message:', error);
    message.reply('Sorry, something went wrong!');
  }
});

async function alwaysRespond(interaction) {
  const userId = interaction.user.id;
  const channelId = interaction.channelId;

  // Ensure the channel is initialized in activeUsersInChannels
  if (!activeUsersInChannels[channelId]) {
    activeUsersInChannels[channelId] = {};
  }

  // Toggle the state for the current channel and user
  if (activeUsersInChannels[channelId][userId]) {
    delete activeUsersInChannels[channelId][userId];

    // Send an ephemeral message to the user who interacted
    await interaction.reply({ content: '> Bot response to your messages is turned `OFF`.', ephemeral: true });
  } else {
    activeUsersInChannels[channelId][userId] = true;

    // Send an ephemeral message to the user who interacted
    await interaction.reply({ content: '> Bot response to your messages is turned `ON`.', ephemeral: true });
  }
}

async function clearChatHistory(interaction) {
  chatHistories[interaction.user.id] = [];

  // Send an ephemeral message to the user who interacted
  await interaction.reply({ content: '> `Chat history cleared!`', ephemeral: true });
}

client.on('interactionCreate', async (interaction) => {
  // Check if the interaction is a button click
  if (interaction.isButton()) {
    // Handle the interaction based on the customId of the button clicked
    if (interaction.customId === 'settings') {
      await showSettings(interaction);
    } else if (interaction.customId === 'clear') {
      await clearChatHistory(interaction);
    } else if (interaction.customId === 'always-respond') {
      await alwaysRespond(interaction);
    } else if (interaction.customId === 'custom-personality') {
      await setCustomPersonality(interaction);
    } else if (interaction.customId === 'remove-personality') {
      await removeCustomPersonality(interaction);
    }
  } else if (interaction.isModalSubmit()) {
    await handleModalSubmit(interaction);
  }
});

async function handleModalSubmit(interaction) {
  if (interaction.customId === 'custom-personality-modal') {
    const customInstructionsInput = interaction.fields.getTextInputValue('custom-personality-input');
    customInstructions[interaction.user.id] = customInstructionsInput.trim();

    await interaction.reply({ content: '> Custom personality instructions saved!' });

    setTimeout(() => interaction.deleteReply(), 10000); // Delete after 10 seconds
  }
}

async function setCustomPersonality(interaction) {
  const customId = 'custom-personality-input';
  const title = 'Enter Custom Personality Instructions';

  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel("What should the bot's personality be like?")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Enter the custom instructions here...")
    .setMinLength(10)
    .setMaxLength(4000);

  const modal = new ModalBuilder()
    .setCustomId('custom-personality-modal')
    .setTitle(title)
    .addComponents(new ActionRowBuilder().addComponents(input));

  // Present the modal to the user
  await interaction.showModal(modal);
}

async function showSettings(interaction) {
  const clearButton = new ButtonBuilder()
    .setCustomId('clear')
    .setLabel('Clear Chat')
    .setStyle(ButtonStyle.Danger);

  const toggleChatButton = new ButtonBuilder()
    .setCustomId('always-respond')
    .setLabel('Always Respond')
    .setStyle(ButtonStyle.Secondary);
    
  const customPersonalityButton = new ButtonBuilder()
    .setCustomId('custom-personality')
    .setLabel('Custom Personality')
    .setStyle(ButtonStyle.Primary);
    
  const removePersonalityButton = new ButtonBuilder()
    .setCustomId('remove-personality')
    .setLabel('Remove Personality')
    .setStyle(ButtonStyle.Danger);

  const actionRow = new ActionRowBuilder().addComponents(clearButton, toggleChatButton, customPersonalityButton, removePersonalityButton);

  await interaction.reply({
    content: '> ```Settings:```',
    components: [actionRow],
    ephemeral: true
  });
}

async function removeCustomPersonality(interaction) {
  // Remove the custom instructions for the user
  delete customInstructions[interaction.user.id];

  // Let the user know their custom instructions have been removed
  await interaction.reply({ content: "> Custom personality instructions removed!", ephemeral: true });
}

// handleTextFileMessage function to handle multiple file attachments
async function handleTextFileMessage(message) {
  let messageContent = message.content.replace(new RegExp(`<@!?${client.user.id}>`), '').trim();

  const fileAttachments = message.attachments.filter((attachment) =>
    attachment.contentType?.startsWith('application/pdf') ||
    attachment.contentType?.startsWith('text/plain') ||
    attachment.contentType?.startsWith('text/html') ||
    attachment.contentType?.startsWith('text/css') ||
    attachment.contentType?.startsWith('application/javascript') ||
    attachment.contentType?.startsWith('application/json')
  );

  if (fileAttachments.size > 0) {
    let botMessage = await message.reply({ content: 'Processing your document(s)...' });
    let formattedMessage = messageContent;

    // Retrieve extracted text from all attachments
    for (const [attachmentId, attachment] of fileAttachments) {
      let extractedText;
      if (attachment.contentType?.startsWith('application/pdf')) {
        extractedText = await extractTextFromPDF(attachment.url);
      } else {
        extractedText = await fetchTextContent(attachment.url);
      }
      formattedMessage += `\n\n[${attachment.name}] File Content:\n"${extractedText}"`;
    }

    // Load the text model for handling the conversation
    const model = await genAI.getGenerativeModel({ model: 'gemini-pro' });

    const chat = model.startChat({
      history: getHistory(message.author.id),
    });

    await handleModelResponse(botMessage, () => chat.sendMessageStream(formattedMessage), message);
  }
}

function hasTextFileAttachments(message) {
  return message.attachments.some((attachment) =>
    attachment.contentType?.startsWith('application/pdf') ||
    attachment.contentType?.startsWith('text/plain') ||
    attachment.contentType?.startsWith('text/html') ||
    attachment.contentType?.startsWith('text/css') ||
    attachment.contentType?.startsWith('application/javascript') ||
    attachment.contentType?.startsWith('application/json')
  );
}

async function fetchTextContent(url) {
  try {
    const response = await fetch(url);
    return await response.text();
  } catch (error) {
    console.error('Error fetching text content:', error);
    throw new Error('Could not fetch text content from file');
  }
}

async function scrapeWebpageContent(url) {
  try {
    const response = await fetch(url);
    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove script and style tags along with their content
    $('script, style').remove();

    // Extract and clean the text content within the <body> tag
    let bodyText = $('body').text();

    // Remove any text that might still be enclosed in angle brackets
    bodyText = bodyText.replace(/<[^>]*>?/gm, '');

    // Trim leading and trailing white-space and return
    return bodyText.trim();

  } catch (error) {
    console.error('Error scraping webpage content:', error);
    throw new Error('Could not scrape content from webpage');
  }
}

async function handleTextMessage(message) {
  const model = await genAI.getGenerativeModel({ model: 'gemini-pro' });
  let botMessage;
  const userId = message.author.id;
  let messageContent = message.content.replace(new RegExp(`<@!?${client.user.id}>`), '').trim();
  if (messageContent === '') {
    await message.reply("> `It looks like you didn't say anything. What would you like to talk about?`");
    return;
  }
  
  activeRequests.add(userId);
  botMessage = await message.reply('> `Let me think...`');
  const chat = model.startChat({
    history: getHistory(message.author.id),
  });
  await handleModelResponse(botMessage, () => chat.sendMessageStream(messageContent), message);
}

function extractUrls(text) {
  return text.match(/\bhttps?:\/\/\S+/gi) || [];
}

async function handleModelResponse(botMessage, responseFunc, originalMessage) {
  const userId = originalMessage.author.id;

  try {
    const messageResult = await responseFunc();
    let finalResponse = '';
    let isLargeResponse = false;

    for await (const chunk of messageResult.stream) {
      const chunkText = await chunk.text();
      finalResponse += chunkText;

      if (!isLargeResponse && finalResponse.length > 1900) {
        await botMessage.edit('The response is too large and will be sent as a text file once it is ready.');
        isLargeResponse = true;
      } else if (!isLargeResponse) {
        await botMessage.edit({ content: finalResponse });
      }
    }

    if (isLargeResponse) {
      await sendAsTextFile(finalResponse, originalMessage);
    } else {
      await addSettingsButton(botMessage);
    }

    updateChatHistory(originalMessage.author.id, originalMessage.content.replace(new RegExp(`<@!?${client.user.id}>`), '').trim(), finalResponse);
  } catch (error) {
    console.error('Error handling model response:', error);
    await botMessage.edit({ content: 'Sorry, an error occurred while generating a response.' });
  } finally {
    activeRequests.delete(userId);
  }
}

async function sendAsTextFile(text, message) {
  const filename = `response-${Date.now()}.txt`;
  await writeFile(filename, text);
  await message.reply({ content: 'Here is the response:', files: [filename] });

  // Cleanup: Remove the file after sending it
  await unlink(filename);
}

// Function to extract text from a PDF file
async function extractTextFromPDF(url) {
  try {
    const response = await fetch(url);
    const buffer = await response.buffer();

    let data = await pdf(buffer);
    return data.text;
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    throw new Error('Could not extract text from PDF');
  }
}

function getHistory(userId) {
  return chatHistories[userId]?.map((line, index) => ({
    role: index % 2 === 0 ? 'user' : 'model',
    parts: line,
  })) || [];
}

function updateChatHistory(userId, userMessage, modelResponse) {
  if (!chatHistories[userId]) {
    chatHistories[userId] = [];
  }
  chatHistories[userId].push(userMessage);
  chatHistories[userId].push(modelResponse);
}

async function addSettingsButton(botMessage) {
  const settingsButton = new ButtonBuilder()
    .setCustomId('settings')
    .setEmoji('⚙️')
    .setStyle(ButtonStyle.Secondary);

  const actionRow = new ActionRowBuilder().addComponents(settingsButton);
  await botMessage.edit({ components: [actionRow] });
}

client.login(process.env.DISCORD_BOT_TOKEN);