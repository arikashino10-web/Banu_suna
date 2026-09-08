const axios = require("axios");

const apiList = "https://gitlab.com/shahadat-sahu/sahu-api/-/raw/main/API.json";
const getMainAPI = async () => (await axios.get(apiList)).data.simsimi;

const arafat = [
  "baby",
  "bby",
  "babu",
  "bbu",
  "jan",
  "bot",
  "জান",
  "জানু",
  "বেবি",
  "wifey",
  "hinata",
];

module.exports.config = {
 name: "baby",
 aliases: ["bby", "jan", "janu", "wifey", "bot", "hinata", "জান", "জানু", "babu", "বেবি", "bbu"],
 version: "1.0.3",
 author: "ULLASH edit by Arafat",
 role: 0,
 countDown: 0,
 description: "Cute AI Baby Chatbot | Talk, Teach & Chat with Emotion ☢️",
 category: "chat",
 guide: { en: "{pn} [message]" }
};

module.exports.onStart = async ({
    api,
    event,
    args,
    usersData
}) => {
    const link = `${await getMainAPI()}`;
    const dipto = args.join(" ").toLowerCase();
    const uid = event.senderID;
    let command, comd, final;

    try {
        if (!args[0]) {
            const ran = ["Bolo baby", "hum", "type help baby", "type !baby hi"];
            return api.sendMessage(ran[Math.floor(Math.random() * ran.length)], event.threadID, event.messageID);
        }

        if (args[0] === 'remove') {
            const fina = dipto.replace("remove ", "");
            const dat = (await axios.get(`${link}?remove=${fina}&senderID=${uid}`)).data.message;
            return api.sendMessage(dat, event.threadID, event.messageID);
        }

        if (args[0] === 'rm' && dipto.includes('-')) {
            const [fi, f] = dipto.replace("rm ", "").split(/\s*-\s*/);
            const da = (await axios.get(`${link}?remove=${fi}&index=${f}`)).data.message;
            return api.sendMessage(da, event.threadID, event.messageID);
        }

        if (args[0] === 'list') {
            if (args[1] === 'all') {
                const data = (await axios.get(`${link}?list=all`)).data;
                const limit = parseInt(args[2]) || 100;
                const limited = data?.teacher?.teacherList?.slice(0, limit);
                const teachers = await Promise.all(limited.map(async (item) => {
                    const number = Object.keys(item)[0];
                    const value = item[number];
                    const name = await usersData.getName(number).catch(() => number) || "Not found";
                    return { name, value };
                }));
                teachers.sort((a, b) => b.value - a.value);
                const output = teachers.map((t, i) => `${i + 1}/ ${t.name}: ${t.value}`).join('\n');
                return api.sendMessage(`Total Teach = ${data.length}\n👑 | List of Teachers of baby\n${output}`, event.threadID, event.messageID);
            } else {
                const d = (await axios.get(`${link}?list=all`)).data;
                return api.sendMessage(`🐤 | Total Teach = ${d.length || "api off"}\n♻️ | Total Response = ${d.responseLength || "api off"}`, event.threadID, event.messageID);
            }
        }

        if (args[0] === 'msg') {
            const fuk = dipto.replace("msg ", "");
            const d = (await axios.get(`${link}?list=${fuk}`)).data.data;
            return api.sendMessage(`Message ${fuk} = ${d}`, event.threadID, event.messageID);
        }

        if (args[0] === 'edit') {
            const command = dipto.split(/\s*-\s*/)[1];
            if (command.length < 2) return api.sendMessage('❌ | Invalid format! Use edit [YourMessage] - [NewReply]', event.threadID, event.messageID);
            const dA = (await axios.get(`${link}?edit=${args[1]}&replace=${command}&senderID=${uid}`)).data.message;
            return api.sendMessage(`changed ${dA}`, event.threadID, event.messageID);
        }

        if (args[0] === 'teach' && args[1] !== 'amar' && args[1] !== 'react') {
            [comd, command] = dipto.split(/\s*-\s*/);
            final = comd.replace("teach ", "");
            if (command.length < 2) return api.sendMessage('❌ | Invalid format!', event.threadID, event.messageID);
            const re = await axios.get(`${link}?teach=${final}&reply=${command}&senderID=${uid}&threadID=${event.threadID}`);
            const tex = re.data.message;
            const teacher = (await usersData.get(re.data.teacher)).name;
            return api.sendMessage(`✅ Replies added ${tex}\nTeacher: ${teacher}\nTeachs: ${re.data.teachs}`, event.threadID, event.messageID);
        }

        if (args[0] === 'teach' && args[1] === 'amar') {
            [comd, command] = dipto.split(/\s*-\s*/);
            final = comd.replace("teach ", "");
            if (command.length < 2) return api.sendMessage('❌ | Invalid format!', event.threadID, event.messageID);
            const tex = (await axios.get(`${link}?teach=${final}&senderID=${uid}&reply=${command}&key=intro`)).data.message;
            return api.sendMessage(`✅ Replies added ${tex}`, event.threadID, event.messageID);
        }

        if (args[0] === 'teach' && args[1] === 'react') {
            [comd, command] = dipto.split(/\s*-\s*/);
            final = comd.replace("teach react ", "");
            if (command.length < 2) return api.sendMessage('❌ | Invalid format!', event.threadID, event.messageID);
            const tex = (await axios.get(`${link}?teach=${final}&react=${command}`)).data.message;
            return api.sendMessage(`✅ Replies added ${tex}`, event.threadID, event.messageID);
        }

        if (dipto.includes('amar name ki') || dipto.includes('amr nam ki') || dipto.includes('amar nam ki') || dipto.includes('amr name ki') || dipto.includes('whats my name')) {
            const data = (await axios.get(`${link}?text=amar name ki&senderID=${uid}&key=intro`)).data.reply;
            return api.sendMessage(data, event.threadID, event.messageID);
        }

        const d = (await axios.get(`${link}?text=${dipto}&senderID=${uid}&font=1`)).data.reply;
        if (!d) return api.sendMessage("• please teach me Baby 🐥", event.threadID, event.messageID);
        api.sendMessage(d, event.threadID, (error, info) => {
            if (!error && info) {
                global.GoatBot.onReply.set(info.messageID, {
                    commandName: module.exports.config.name,
                    type: "reply",
                    messageID: info.messageID,
                    author: event.senderID,
                    d,
                    apiUrl: link
                });
            }
        }, event.messageID);

    } catch (e) {
        console.log(e);
        api.sendMessage("Check console for error", event.threadID, event.messageID);
    }
};

module.exports.onReply = async function ({ api, event, usersData: Users }) {
 try {
 const body = event.body ? event.body.toLowerCase() : "";
 const triggered = arafat.some(word => body.startsWith(word));
 if (triggered) {
  api.setMessageReaction("🪽", event.messageID, () => {}, true);
  api.sendTypingIndicator(event.threadID, true);
 }

 const attachments = event.attachments || [];
 const hasMedia = attachments.length > 0;

 if (hasMedia) {
  const type = attachments[0]?.type || "";
  const mediaReplies = {
   photo: [
    "𝗔𝗷𝗸𝗲 𝗺𝗯 𝗻𝗮𝗶𝗶 𝗯𝗼𝗹𝗲 𝗽𝗵𝗼𝘁𝗼 𝘁𝗮 𝘃𝗮𝗹𝗼 𝗸𝗼𝗿𝗲 𝗱𝗲𝗸𝗵𝘁𝗲 𝗽𝗮𝗿𝗹𝗮𝗺 𝗻𝗮𝗵 ☹️",
    "𝗘𝗶 𝗽𝗵𝗼𝘁𝗼 𝘁𝗮 𝗱𝗲𝗸𝗵𝗲 𝗺𝗼𝗻 𝘁𝗮 𝗲𝗸𝘁𝘂 𝘃𝗮𝗹𝗼 𝗵𝗼𝘆𝗲 𝗴𝗲𝗹𝗼 🥺",
    "𝗛𝗼𝘁𝗮𝘁 𝗽𝗵𝗼𝘁𝗼 𝗱𝗶𝗹𝗲 𝗷𝗲, 𝗲𝘁𝗮 𝗸𝗶 𝗺𝗼𝗱𝗲𝗹𝗶𝗻𝗴 𝗲𝗿 𝗷𝗼𝗻𝗻𝗼? 😂",
    "𝗘𝗸𝘁𝗮 𝗸𝗼𝘁𝗵𝗮 𝗯𝗼𝗹𝗯𝗼? 𝗘𝗶 𝗽𝗵𝗼𝘁𝗼 𝘁𝗮 𝘀𝗮𝘃𝗲 𝗸𝗼𝗿𝗲 𝗿𝗮𝗸𝗵𝗯𝗼 😌",
    "𝗘𝘁𝗼 𝘀𝘂𝗻𝗱𝗼𝗿 𝗽𝗵𝗼𝘁𝗼 𝗽𝗮𝘁𝗵𝗮𝗼 𝗸𝗲𝗻𝗼, 𝗹𝗼𝗷𝗷𝗮 𝗹𝗮𝗴𝗲 𝘁𝗼 🤭",
    "𝗘𝗶 𝗽𝗵𝗼𝘁𝗼 𝗿 𝗷𝗼𝗻𝗻𝗼 𝗺𝗯 𝗸𝗵𝗼𝗿𝗼𝗰𝗵 𝗸𝗼𝗿𝗮 𝘄𝗼𝗿𝘁𝗵 𝗶𝘁 𝗰𝗵𝗶𝗹𝗼 😂",
    "𝗧𝘂𝗺𝗶 𝗸𝗶 𝗽𝗵𝗼𝘁𝗼𝗴𝗿𝗮𝗽𝗵𝗲𝗿 𝗻𝗮𝗸𝗶 𝗻𝗮𝘁𝘂𝗿𝗮𝗹𝗹𝘆 𝗲𝗶 𝘁𝗮𝗹𝗲𝗻𝘁? 🫢"
   ],
   audio: [
    "𝗔𝗷𝗸𝗲 𝗺𝗯 𝗻𝗮𝗶𝗶 𝗯𝗼𝗹𝗲 𝘃𝗼𝗶𝗰𝗲 𝘁𝗮 𝘀𝗵𝘂𝗻𝘁𝗲 𝗽𝗮𝗿𝗹𝗮𝗺 𝗻𝗮𝗵 ☹️",
    "𝗘𝗶 𝗴𝗮𝗮𝗻 𝘁𝗮 𝗽𝗮𝘁𝗵𝗮𝗶𝘀𝗼, 𝗲𝗸𝗵𝗼𝗻 𝗺𝗮𝘁𝗵𝗮 𝘁𝗵𝗲𝗸𝗲 𝗷𝗮𝗯𝗲 𝗻𝗮𝗵 🤦‍♀️",
    "𝗚𝗮𝗮𝗻 𝘀𝗵𝘂𝗻𝗲 𝗻𝗮𝗰𝗵𝘁𝗲 𝗶𝗰𝗵𝗵𝗲 𝗸𝗼𝗿𝗰𝗵𝗲, 𝗸𝗲𝘂 𝗱𝗲𝗸𝗵𝗹𝗲 𝗹𝗼𝗷𝗷𝗮 𝗽𝗮𝗯𝗼 💃😂",
    "𝗘𝗶 𝗮𝘂𝗱𝗶𝗼 𝘁𝗮 𝘀𝗵𝘂𝗻𝗲 𝗺𝗼𝗻 𝘁𝗮 𝗳𝗿𝗲𝘀𝗵 𝗵𝗼𝘆𝗲 𝗴𝗲𝗹𝗼 𝗲𝗸𝗱𝗼𝗺 🥺",
    "𝗥𝗲𝗽𝗲𝗮𝘁 𝗲 𝗱𝗶𝘆𝗲 𝗿𝗮𝗸𝗵𝘀𝗶, 𝘁𝗵𝗮𝗺𝗮𝘁𝗲 𝗽𝗮𝗿𝗰𝗵𝗶 𝗻𝗮𝗵 🔁😌",
    "𝗧𝘂𝗺𝗶 𝗽𝗮𝘁𝗵𝗮𝗶𝘀𝗼 𝗯𝗼𝗹𝗲 𝘀𝗵𝘂𝗻𝗹𝗮𝗺, 𝗻𝗮𝗵𝗼𝗹𝗲 𝘀𝗵𝘂𝗻𝘁𝗮𝗺 𝗻𝗮𝗵 😏",
    "𝗘𝗶 𝗴𝗮𝗮𝗻 𝗿 𝘁𝗮𝘀𝘁𝗲 𝗱𝗲𝗸𝗵𝗲 𝗯𝘂𝗷𝗵𝗮 𝗷𝗮𝘆 𝘁𝘂𝗺𝗶 𝗲𝗸𝗷𝗼𝗻 𝘀𝗽𝗲𝗰𝗶𝗮𝗹 𝗺𝗮𝗻𝘂𝘀𝗵 😍",
    "𝗚𝗮𝗮𝗻 𝘀𝗵𝘂𝗻𝗲 𝗲𝗸𝗹𝗮 𝗲𝗸𝗹𝗮 𝗻𝗮𝗰𝗵𝘀𝗶, 𝗸𝗲𝘂 𝗱𝗲𝗸𝗵𝘀𝗼 𝗻𝗮𝗵 𝘁𝗼𝗵?💃🤭"
   ],
   video: [
    "𝗔𝗷𝗸𝗲 𝗺𝗯 𝗻𝗮𝗶𝗶 𝗯𝗼𝗹𝗲 𝘃𝗶𝗱𝗲𝗼 𝘁𝗮 𝗱𝗲𝗸𝗵𝘁𝗲 𝗽𝗮𝗿𝗹𝗮𝗺 𝗻𝗮𝗵 ☹️",
    "𝗩𝗶𝗱𝗲𝗼 𝘁𝗮 𝗱𝗲𝗸𝗵𝗲 𝗵𝗮𝘀𝗶 𝘁𝗵𝗮𝗺𝗮𝘁𝗲 𝗽𝗮𝗿𝗰𝗵𝗶 𝗻𝗮𝗵 𝗵𝗲𝗹𝗽 😂",
    "𝗘𝗶 𝘃𝗶𝗱𝗲𝗼 𝗿 𝗷𝗼𝗻𝗻𝗼 𝗱𝗮𝘁𝗮 𝗸𝗵𝗼𝗿𝗼𝗰𝗵 𝗸𝗼𝗿𝗮 𝗲𝗸𝗱𝗼𝗺 𝘀𝗮𝗿𝘁𝗵𝗼𝗸 🥹",
    "𝗘𝘁𝗼 𝘃𝗶𝗱𝗲𝗼 𝗽𝗮𝘁𝗵𝗮𝗼 𝗸𝗲𝗻𝗼, 𝗸𝗮𝗮𝗷 𝗸𝗼𝗿𝘁𝗲 𝗽𝗮𝗿𝗰𝗵𝗶 𝗻𝗮𝗵 😒",
    "𝗩𝗶𝗱𝗲𝗼 𝘁𝗮 𝘀𝗵𝗲𝘀𝗵 𝗵𝗼𝘄𝗮𝗿 𝗽𝗼𝗿𝗲 𝗼 𝗵𝗮𝘀𝗶 𝘁𝗵𝗮𝗺𝘀𝗲 𝗻𝗮𝗵 🤣"
   ],
   sticker: [
    "𝗦𝘁𝗶𝗰𝗸𝗲𝗿 𝗽𝗮𝘁𝗵𝗮𝗶𝘀𝗲, 𝘁𝘆𝗽𝗲 𝗸𝗼𝗿𝘁𝗲 𝘃𝗼𝘆 𝗹𝗮𝗴𝗲 𝗻𝗮𝗸𝗶? 🤭",
    "𝗖𝘂𝘁𝗲 𝘀𝘁𝗶𝗰𝗸𝗲𝗿 𝗯𝘂𝘁 𝘁𝘂𝗺𝗶 𝗲𝗿 𝘁𝗵𝗲𝗸𝗲 𝗯𝗲𝘀𝗵𝗶 𝗰𝘂𝘁𝗲 🥺",
    "𝗦𝘁𝗶𝗰𝗸𝗲𝗿 𝗱𝗶𝘆𝗲 𝗸𝗼𝘁𝗵𝗮 𝗯𝗼𝗹𝗮 𝘀𝗵𝗶𝗸𝗵𝗲 𝗴𝗲𝘀𝗼, 𝗹𝗲𝗴𝗲𝗻𝗱 😁",
    "𝗘𝗶 𝘀𝘁𝗶𝗰𝗸𝗲𝗿 𝘁𝗮 𝗮𝗺𝗮𝗿 𝗽𝗲𝗿𝘀𝗼𝗻𝗮𝗹𝗶𝘁𝘆 𝗱𝗲𝘀𝗰𝗿𝗶𝗯𝗲 𝗸𝗼𝗿𝗲 𝗽𝗲𝗿𝗳𝗲𝗰𝘁𝗹𝘆 😌",
    "𝗠𝗼𝗻 𝘁𝗮 𝘃𝗮𝗹𝗼 𝗸𝗼𝗿𝗲 𝗱𝗶𝗹𝗲 𝗲𝗶 𝘀𝘁𝗶𝗰𝗸𝗲𝗿 𝗱𝗶𝘆𝗲 😊",
    "𝗜𝗰𝗼𝗻𝗶𝗰 𝘀𝘁𝗶𝗰𝗸𝗲𝗿, 𝘁𝗼𝗺𝗮𝗿 𝗰𝗵𝗼𝗶𝗰𝗲 𝗲𝗸𝗱𝗼𝗺 𝗳𝗶𝗿𝘀𝘁 𝗰𝗹𝗮𝘀𝘀 😍"
   ],
   animated_image: [
    "𝗔𝗷𝗸𝗲 𝗺𝗯 𝗻𝗮𝗶𝗶 𝗯𝗼𝗹𝗲 𝗴𝗶𝗳 𝘁𝗮 𝘃𝗮𝗹𝗼 𝗸𝗼𝗿𝗲 𝗱𝗲𝗸𝗵𝘁𝗲 𝗽𝗮𝗿𝗹𝗮𝗺 𝗻𝗮𝗵 😭",
    "𝗘𝗶 𝗚𝗜𝗙 𝘁𝗮 𝗽𝗮𝘁𝗵𝗮𝗶𝘀𝗲 𝗮𝗿 𝗰𝗵𝗼𝗹𝗲 𝗴𝗲𝘀𝗲 𝗹𝗲𝗴𝗲𝗻𝗱 𝗲𝗿 𝗺𝗼𝘁𝗼 😂💀",
    "𝗚𝗜𝗙 𝗱𝗲𝗸𝗵𝗲 𝗽𝗲𝘁 𝗯𝗲𝘁𝗵𝗮 𝗵𝗼𝘆𝗲 𝗴𝗲𝘀𝗲 𝗵𝗮𝘀𝘁𝗲 𝗵𝗮𝘀𝘁𝗲 😂",
    "𝗕𝗼𝗿𝗼 𝗳𝘂𝗻𝗻𝘆 𝗺𝗮𝗻𝘂𝘀𝗵 𝘁𝘂𝗺𝗶, 𝗲𝗶 𝗚𝗜𝗙 𝗲 𝗽𝗿𝗼𝘃𝗲 𝗵𝗼𝘆𝗲 𝗴𝗲𝗹𝗼 😂",
    "𝗚𝗜𝗙 𝘁𝗮 𝘀𝗮𝘃𝗲 𝗸𝗼𝗿𝗲 𝗿𝗮𝗸𝗵𝘀𝗶, 𝗽𝗼𝗿𝗲 𝗸𝗮𝗷𝗲 𝗹𝗮𝗴𝗯𝗲 😌",
    "𝗘𝗶 𝗚𝗜𝗙 𝗿 𝗷𝗼𝗻𝗻𝗼 𝗺𝗯 𝗴𝗲𝘀𝗲 𝗯𝘂𝘁 𝘄𝗼𝗿𝘁𝗵 𝗶𝘁 𝗰𝗵𝗶𝗹𝗼 🥹🔥",
    "𝗚𝗜𝗙 𝗽𝗮𝘁𝗵𝗮𝗹𝗲 𝗮𝗺𝗶 𝗵𝗮𝘀𝗯𝗼, 𝘁𝘂𝗺𝗶 𝗷𝗮𝗻𝘁𝗮 𝘁𝗮𝗶 𝗽𝗮𝘁𝗵𝗮𝗶𝘀𝗼 𝘁𝗮𝗶𝗶 𝗻𝗮𝗵? 😏"
   ]
  };

  const category = mediaReplies[type] || mediaReplies["sticker"];
  const reply = category[Math.floor(Math.random() * category.length)];
  return await api.sendMessage(reply, event.threadID, (err, info) => {
   if (!err) {
    global.GoatBot.onReply.set(info.messageID, {
     commandName: module.exports.config.name,
     messageID: info.messageID,
     author: event.senderID,
     type: "simsimi"
    });
   }
  }, event.messageID);
 }

 const senderName = await Users.getName(event.senderID);
 const replyText = event.body ? event.body.toLowerCase() : "";
 if (!replyText) return;
 const simsim = await getMainAPI();
 const res = await axios.get(`${simsim}/simsimi?text=${encodeURIComponent(replyText)}&senderName=${encodeURIComponent(senderName)}`);
 const replies = Array.isArray(res.data.response) ? res.data.response : [res.data.response];

 for (const rep of replies) {
 await new Promise(resolve => {
 api.sendMessage(rep, event.threadID, (err, info) => {
 if (!err) {
 global.GoatBot.onReply.set(info.messageID, {
 commandName: module.exports.config.name,
 messageID: info.messageID,
 author: event.senderID,
 type: "simsimi"
 });
 }
 resolve();
 }, event.messageID);
 });
 }

 } catch (err) {
 return api.sendMessage(`Error: ${err.message}`, event.threadID, event.messageID);
 }
};

module.exports.onChat = async ({ api, event, message }) => {
 try {
  const body = event.body ? event.body.toLowerCase() : "";
  if (event.type !== "message_reply" && arafat.some(word => body.startsWith(word))) {
   api.setMessageReaction("🪽", event.messageID, () => {}, true);
   api.sendTypingIndicator(event.threadID, true);
   const arr = (() => {
    for (const prefix of arafat) {
     if (body.startsWith(prefix)) return body.substring(prefix.length).trim();
    }
    return "";
   })();
   const randomReplies = [
        "babu khuda lagse🥺",
          "Hop beda😾,Boss বল boss😼",  
          "আমাকে ডাকলে ,আমি কিন্তূ কিস করে দেবো 😘 ",  
          "🐒🐒🐒",
          "bye",
          "naw amr boss k message daw https://www.facebook.com/profile.php?id=61576355017916",
          "mb nei bye",
          "meww",
          "গোলাপ ফুল এর জায়গায় আমি দিলাম তোমায় মেসেজ 😘",
          "বলো কি বলবা, সবার সামনে বলবা নাকি?🤭🤏",  
          "𝗜 𝗹𝗼𝘃𝗲 𝘆𝗼𝘂__😘😘",
          "𝗜 𝗵𝗮𝘁𝗲 𝘆𝗼𝘂__😏😏",
          "গোসল করে আসো যাও😑😩",
          "আসসালামু আলাইকুম",
          "কেমন আছো_🥹",
          "বলেন sir__😌",
          "বলেন ম্যাডাম__😌",
          "আমি অন্যের জিনিসের সাথে কথা বলি না__😏ওকে",
          "🙂🙂🙂",
          "এটাই দেখার বাকি ছিলো_🙂🙂🙂",
          "𝗕𝗯𝘆 𝗯𝗼𝗹𝗹𝗮 𝗽𝗮𝗽 𝗵𝗼𝗶𝗯𝗼 😒😒",
          "𝗧𝗮𝗿𝗽𝗼𝗿 𝗯𝗼𝗹𝗼_🙂",
          "𝗕𝗲𝘀𝗵𝗶 𝗱𝗮𝗸𝗹𝗲 𝗮𝗺𝗺𝘂 𝗯𝗼𝗸𝗮 𝗱𝗶𝗯𝗲 𝘁𝗼__🥺",
          "𝗕𝗯𝘆 না জানু, বল 😌",
          "বেশি bby bby করলে leave নিবো কিন্তু 😒😒",
          "__বেশি বেবি বললে কামুর দিমু 🤭🤭",
          "𝙏𝙪𝙢𝙖𝙧 𝙜𝙛 𝙣𝙖𝙞, 𝙩𝙖𝙞 𝙖𝙢𝙖𝙠𝗲 𝙙𝙖𝙠𝙨𝙤? 😂😂😂",
          "bolo baby😒",
          "তোর কথা তোর বাড়ি কেউ শুনে না ,তো আমি কোনো শুনবো ?🤔😂",
          "আমি তো অন্ধ কিছু দেখি না🐸 😎",
          "আম গাছে আম নাই ঢিল কেন মারো, তোমার সাথে প্রেম নাই বেবি কেন ডাকো 😒🫣",
          "𝗼𝗶𝗶 ঘুমানোর আগে.! তোমার মনটা কোথায় রেখে ঘুমাও.!🤔_নাহ মানে চুরি করতাম 😞😘",
          "𝗕𝗯𝘆 না বলে 𝗕𝗼𝘄 বলো 😘",
          "দূরে যা, তোর কোনো কাজ নাই, শুধু 𝗯𝗯𝘆 𝗯𝗯𝘆 করিস  😉😋🤣",
          "এই এই তোর পরীক্ষা কবে? শুধু 𝗕𝗯𝘆 𝗯𝗯𝘆 করিস 😾",
          "তোরা যে হারে 𝗕𝗯𝘆 ডাকছিস আমি তো সত্যি বাচ্চা হয়ে যাবো_☹😑",
          "আজব তো__😒",
          "আমাকে ডেকো না,আমি ব্যাস্ত আছি🙆🏻‍♀",
          "𝗕𝗯𝘆 বললে চাকরি থাকবে না",
          "𝗕𝗯𝘆 𝗕𝗯𝘆 না করে আমার বস মানে, JABED ও তো করতে পারো😑?",
          "আমার সোনার বাংলা, তারপরের লাইন কি? 🙈",
          "🍺 এই নাও জুস খাও..!𝗕𝗯𝘆 বলতে বলতে হাপায় গেছো না 🥲",
          "হটাৎ আমাকে মনে পড়লো 🙄",
          "𝗕𝗯𝘆 বলে অসম্মান করতেছিস,😰😿",
          "𝗔𝘀𝘀𝗮𝗹𝗮𝗺𝘂𝗹𝗮𝗶𝗸𝘂𝗺 🐤🐤",
          "আমি তোমার সিনিয়র আপু ওকে 😼সম্মান দেও🙁",
          "খাওয়া দাওয়া করছো?🙄",
          "এত কাছেও এসো না,প্রেম এ পরে যাবো তো 🙈",
          "আরে আমি মজা করার mood এ নাই😒",
          "𝗛𝗲𝘆 𝗛𝗮𝗻𝗱𝘀𝗼𝗺𝗲 বলো 😁😁",
          "আরে Bolo আমার জান, কেমন আছো? 😚",
          "একটা BF খুঁজে দাও 😿",
          "ফ্রেন্ড রিকোয়েস্ট দিলে ৫ টাকা দিবো 😗",
          "oi mama ar dakis na pilis 😿",
          "🐤🐤",
          "__ভালো হয়ে  যাও 😑😒",
          "এমবি কিনে দাও না_🥺🥺",
          "ওই মামা_আর ডাকিস না প্লিজ😫",
          "৩২ তারিখ আমার বিয়ে 🐤",
          "হা বলো😒,কি করতে পারি😐😑?",
          "বলো ফুলটুশি_😘",
          "amr JaNu lagbe,Tumi ki single aso?🥹",
          "আমাকে না ডেকে একটু পড়তেও বসতে তো পারো 😒😒",
          "তোর বিয়ে হয় নি 𝗕𝗯𝘆 হইলো কিভাবে,,🙄",
          "আজ একটা ফোন নাই বলে রিপ্লাই দিতে পারলাম না_🙄",
          "চৌধুরী সাহেব আমি গরিব হতে পারি😾🤭 -কিন্তু বড়লোক না🥹 😫",
          "আমি অন্যের জিনিসের সাথে কথা বলি না__😏ওকে",
          "বলো কি বলবা, সবার সামনে বলবা নাকি?🤭🤏",
          "ভুলে যাও আমাকে 😞😞",
          "দেখা হলে কাঠগোলাপ দিও..🤗",
          "শুনবো না😼 তুমি আমাকে প্রেম করাই দাও নি🥺 পচা তুমি🥺",
          "আগে একটা গান বলো, ☹ নাহলে কথা বলবো না 🥺",
          "বলো কি করতে পারি তোমার জন্য 😚",
          "কথা দেও আমাকে পটাবা...!! 😌",
          "বার বার Disturb করেতেছিস কোনো 😾, আমার জানু এর সাথে ব্যাস্ত আছি😋",
          "আমাকে না ডেকে একটু পড়তে বসতেও তো পারো 🥺🥺",
          "বার বার ডাকলে মাথা গরম হয় কিন্তু 😑😒",
          "ওই তুমি single না?🫵🤨 😑😒",
          "বলো জানু 😒",
          "Meow🐤",     
          "আর কত বার ডাকবা ,শুনছি তো 🤷🏻‍♀",
          "কি হলো, মিস টিস করতেছিস নাকি 🤣",
          "Bolo Babu, তুমি কি আমাকে ভালোবাসো? 🙈",
          "আজকে আমার mন ভালো নেই 🙉",
          "আমি হাজারো মশার Crush😓",
          "প্রেম করার বয়সে লেখাপড়া করতেছি, রেজাল্ট তো খা/রা'প হবেই.!🙂",
          "আমার ইয়ারফোন চু'রি হয়ে গিয়েছে!! কিন্তু চোর'কে গা-লি দিলে আমার বন্ধু রেগে যায়!'🙂",
          "ছেলেদের প্রতি আমার এক আকাশ পরিমান শরম🥹🫣",
          "__ফ্রী ফে'সবুক চালাই কা'রন ছেলেদের মুখ দেখা হারাম 😌",
          "মন সুন্দর বানাও মুখের জন্য তো 'Snapchat' আছেই! 🌚"
      ];

   if (!arr) {
    return await api.sendMessage(randomReplies[Math.floor(Math.random() * randomReplies.length)], event.threadID, (err, info) => {
     if (!err && info) {
      global.GoatBot.onReply.set(info.messageID, {
       commandName: module.exports.config.name,
       type: "reply",
       messageID: info.messageID,
       author: event.senderID
      });
     }
    }, event.messageID);
   }
   const simsim = await getMainAPI();
   const res = await axios.get(`${simsim}/simsimi?text=${encodeURIComponent(arr)}`);
   const replies = Array.isArray(res.data.response) ? res.data.response : [res.data.response];
   for (const rep of replies) {
    await new Promise(resolve => {
     api.sendMessage(rep, event.threadID, (err, info) => {
      if (!err && info) {
       global.GoatBot.onReply.set(info.messageID, {
        commandName: module.exports.config.name,
        type: "reply",
        messageID: info.messageID,
        author: event.senderID
       });
      }
      resolve();
     }, event.messageID);
    });
   }
  }
 } catch (err) {
  return api.sendMessage(`Error: ${err.message}`, event.threadID, event.messageID);
 }
};
