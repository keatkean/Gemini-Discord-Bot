import { REST, Routes } from 'discord.js';
import { commands } from '../commands.js';
import dotenv from 'dotenv';

dotenv.config();

console.log("DISCORD_BOT_TOKEN:", process.env.DISCORD_BOT_TOKEN);
console.log("CLIENT_ID:", process.env.CLIENT_ID);

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
  try {
    console.log('Fetching existing commands...');
    
    const existingCommands = await rest.get(Routes.applicationCommands(process.env.CLIENT_ID));

    if (existingCommands.length > 0) {
      console.log(`🔹 Found ${existingCommands.length} existing commands. Deleting them first...`);

      for (const command of existingCommands) {
        await rest.delete(`${Routes.applicationCommands(process.env.CLIENT_ID)}/${command.id}`);
        console.log(`✅ Deleted command: ${command.name}`);
      }
    }

    console.log('Registering new commands...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });

    console.log('✅ Successfully registered commands.');
  } catch (error) {
    console.error('❌ Error registering commands:', error);
  }
})();
