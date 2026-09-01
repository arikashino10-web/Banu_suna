const moment = require("moment-timezone");

// ---- shared helper: fetch one page of pending friend requests ----
async function fetchPage(api, cursor) {
  const variables = { input: { scale: 3 } };
  if (cursor) variables.after = cursor; // pagination cursor, if the API accepts it

  const form = {
    av: api.getCurrentUserID(),
    fb_api_req_friendly_name: "FriendingCometFriendRequestsRootQueryRelayPreloader",
    fb_api_caller_class: "RelayModern",
    doc_id: "4499164963466303",
    variables: JSON.stringify(variables)
  };

  const raw = await api.httpPost("https://www.facebook.com/api/graphql/", form);
  const parsed = JSON.parse(raw);
  const connection = parsed && parsed.data && parsed.data.viewer && parsed.data.viewer.friending_possibilities;

  if (!connection || !Array.isArray(connection.edges)) {
    return { edges: [], hasNextPage: false, endCursor: null };
  }

  const pageInfo = connection.page_info || {};
  return {
    edges: connection.edges,
    hasNextPage: !!(pageInfo.has_next_page && pageInfo.end_cursor),
    endCursor: pageInfo.end_cursor || null
  };
}

function buildListText(listRequest, pageNum) {
  let msg = `📄 Page ${pageNum}\n`;
  let i = 0;
  for (const user of listRequest) {
    i++;
    msg += (`\n${i}. Name: ${user.node.name}`
      + `\nID: ${user.node.id}`
      + `\nUrl: ${user.node.url.replace("www.facebook", "fb")}`
      + `\nTime: ${moment(user.time * 1009).tz("Asia/Manila").format("DD/MM/YYYY HH:mm:ss")}\n`);
  }
  return msg;
}

// Sends a page of requests, wires up BOTH onReply (add/del) and
// onReaction (react = jump to next page) for that message.
async function sendPage({ api, event, commandName, threadID, listRequest, cursor, hasNextPage, pageNum, author }) {
  const text = buildListText(listRequest, pageNum);
  const footer = `\nReply <add: del> <number: or "all"> to take action.` +
    (hasNextPage ? `\nOr react to this message to jump to the next batch.` : `\n(This is the last batch — no more pending requests.)`);

  return new Promise((resolve) => {
    api.sendMessage(`${text}${footer}`, threadID, (err, info) => {
      if (err || !info) return resolve(null);

      const context = {
        commandName,
        messageID: info.messageID,
        listRequest,
        cursor,
        hasNextPage,
        pageNum,
        author
      };

      global.GoatBot.onReply.set(info.messageID, context);
      if (global.GoatBot.onReaction) {
        global.GoatBot.onReaction.set(info.messageID, context);
      }
      resolve(info);
    }, event.messageID);
  });
}

module.exports = {
  config: {
    name: "accept",
    aliases: ['acp'],
    version: "2.0",
    author: "JABED D KURÕ",
    countDown: 8,
    role: 2,
    shortDescription: "accept users",
    longDescription: "accept/decline friend requests, paginated — react to advance, 'add all' auto-advances, single accepts keep the list",
    category: "Utility",
  },

  onStart: async function ({ event, api, commandName }) {
    let page;
    try {
      page = await fetchPage(api, null);
    } catch (e) {
      return api.sendMessage("Failed to load pending friend requests.", event.threadID, event.messageID);
    }

    if (!page.edges || page.edges.length === 0) {
      return api.sendMessage("No pending friend requests found.", event.threadID, event.messageID);
    }

    await sendPage({
      api, event, commandName,
      threadID: event.threadID,
      listRequest: page.edges,
      cursor: page.endCursor,
      hasNextPage: page.hasNextPage,
      pageNum: 1,
      author: event.senderID
    });
  },

  // React to the list message => jump straight to the next batch,
  // no matter what (doesn't require typing "add all" first).
  onReaction: async function ({ event, Reaction, api, commandName }) {
    const ctx = Reaction;
    if (!ctx || ctx.author !== event.userID) return;

    if (!ctx.hasNextPage) {
      return api.sendMessage("এটাই শেষ ব্যাচ — আর কোনো pending request নেই।", event.threadID);
    }

    let nextPage;
    try {
      nextPage = await fetchPage(api, ctx.cursor);
    } catch (e) {
      return api.sendMessage("পরের ব্যাচ আনতে গিয়ে সমস্যা হয়েছে।", event.threadID);
    }

    if (!nextPage.edges || nextPage.edges.length === 0) {
      return api.sendMessage("এটাই শেষ ব্যাচ — আর কোনো pending request নেই।", event.threadID);
    }

    // clear old bindings so old message doesn't double-trigger
    global.GoatBot.onReply.delete(ctx.messageID);
    if (global.GoatBot.onReaction) global.GoatBot.onReaction.delete(ctx.messageID);

    await sendPage({
      api, event, commandName,
      threadID: event.threadID,
      listRequest: nextPage.edges,
      cursor: nextPage.endCursor,
      hasNextPage: nextPage.hasNextPage,
      pageNum: ctx.pageNum + 1,
      author: ctx.author
    });
  },

  onReply: async function ({ message, Reply, event, api, commandName }) {
    const ctx = Reply;
    const { author, listRequest, messageID } = ctx;
    if (author !== event.senderID) return;

    const args = event.body.replace(/ +/g, " ").toLowerCase().split(" ").filter(Boolean);

    const form = {
      av: api.getCurrentUserID(),
      fb_api_caller_class: "RelayModern",
      variables: {
        input: {
          source: "friends_tab",
          actor_id: api.getCurrentUserID(),
          client_mutation_id: Math.round(Math.random() * 19).toString()
        },
        scale: 3,
        refresh_num: 0
      }
    };

    const success = [];
    const failed = [];

    if (args[0] === "add") {
      form.fb_api_req_friendly_name = "FriendingCometFriendRequestConfirmMutation";
      form.doc_id = "3147613905362928";
    } else if (args[0] === "del") {
      form.fb_api_req_friendly_name = "FriendingCometFriendRequestDeleteMutation";
      form.doc_id = "4108254489275063";
    } else {
      return api.sendMessage('Please reply <add: del> <target number: or "all">', event.threadID, event.messageID);
    }

    const isAll = args[1] === "all";
    let targetIDs = args.slice(1);

    if (isAll) {
      targetIDs = [];
      for (let i = 1; i <= listRequest.length; i++) targetIDs.push(i);
    }

    const newTargetIDs = [];
    const promiseFriends = [];

    for (const stt of targetIDs) {
      const u = listRequest[parseInt(stt) - 1];
      if (!u) {
        failed.push(`Can't find stt ${stt} in the list`);
        continue;
      }
      form.variables.input.friend_requester_id = u.node.id;
      form.variables = JSON.stringify(form.variables);
      newTargetIDs.push(u);
      promiseFriends.push(api.httpPost("https://www.facebook.com/api/graphql/", form));
      form.variables = JSON.parse(form.variables);
    }

    for (let i = 0; i < newTargetIDs.length; i++) {
      try {
        const friendRequest = await promiseFriends[i];
        if (JSON.parse(friendRequest).errors) {
          failed.push(newTargetIDs[i].node.name);
        } else {
          success.push(newTargetIDs[i].node.name);
        }
      } catch (e) {
        failed.push(newTargetIDs[i].node.name);
      }
    }

    if (success.length === 0) {
      return api.sendMessage("Invalid response, or nothing was processed successfully.", event.threadID, event.messageID);
    }

    const resultMsg = `» The ${args[0] === 'add' ? 'friend request' : 'friend request deletion'} processed for ${success.length} people:\n\n${success.join("\n")}` +
      (failed.length > 0 ? `\n\n» The following ${failed.length} people encountered errors:\n${failed.join("\n")}` : "");

    api.sendMessage(resultMsg, event.threadID, event.messageID);

    if (isAll) {
      // "add all" / "del all" => this page is fully handled, clean it
      // up and automatically pull in the next batch if one exists.
      global.GoatBot.onReply.delete(messageID);
      if (global.GoatBot.onReaction) global.GoatBot.onReaction.delete(messageID);
      api.unsendMessage(messageID);

      if (!ctx.hasNextPage) {
        return api.sendMessage("সব pending friend request প্রসেস করা শেষ — আর কোনো ব্যাচ নেই।", event.threadID);
      }

      let nextPage;
      try {
        nextPage = await fetchPage(api, ctx.cursor);
      } catch (e) {
        return api.sendMessage("পরের ব্যাচ আনতে গিয়ে সমস্যা হয়েছে।", event.threadID);
      }

      if (!nextPage.edges || nextPage.edges.length === 0) {
        return api.sendMessage("সব pending friend request প্রসেস করা শেষ — আর কোনো ব্যাচ নেই।", event.threadID);
      }

      await sendPage({
        api, event, commandName,
        threadID: event.threadID,
        listRequest: nextPage.edges,
        cursor: nextPage.endCursor,
        hasNextPage: nextPage.hasNextPage,
        pageNum: ctx.pageNum + 1,
        author
      });
    } else {
      // Single / specific-number accept => keep the SAME list active
      // so the user can keep picking more people from it, or react
      // to move on whenever they're ready. Re-register to be safe in
      // case the dispatcher auto-clears reply bindings after one use.
      global.GoatBot.onReply.set(messageID, ctx);
      if (global.GoatBot.onReaction) global.GoatBot.onReaction.set(messageID, ctx);
    }
  }
};
