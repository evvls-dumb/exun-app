uwu
todo
1. make the recent chats in ai window collapse
2. make machine analysis page
3. fix navbar issues
4. okie
5. bye

## Windows tester build

Run `npm run dist:win:testers` to create `dist/Janus-0.1.0-win-x64-testers.exe`.
Send that single file to testers using 64-bit Windows. No installation, Node.js,
or separate backend server is needed. Internet access is required for AI requests.

This build bundles only `GROQ_API_KEY` from your environment or `.env.local`.
Anyone with the executable can recover that key and use its quota. Share it only
with trusted testers and revoke the key when testing is finished. Other local
environment values, chats, and saved credentials are not included.

The initial login accepts any nonempty access key. AI uses the bundled Groq key
automatically unless the tester has already saved their own key in Janus.

Run `npm run dist:win` for a portable build without a bundled API key.
These builds are unsigned, so Windows may display an unknown-publisher warning.
