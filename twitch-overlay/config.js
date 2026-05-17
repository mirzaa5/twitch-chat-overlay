// Edit this file to customize your overlay
// What this file does: central configuration for the Twitch chat overlay
// Exports: window.OVERLAY_CONFIG (globally accessible, no module export)

window.OVERLAY_CONFIG = {
  // Twitch channel to connect to (e.g. "xqc", "pokimane")
  channel: "xqc",

  // Twitch API credentials — needed for real badge images (subscriber, bits, etc.)
  // clientId:   Register a free app at https://dev.twitch.tv/console → get Client ID
  // oauthToken: Get from https://twitchapps.com/tmi/ (copy without the "oauth:" prefix)
  clientId:   "",
  oauthToken: "",

  // Maximum number of chat messages visible at once
  maxMessages: 10,

  // Font settings
  fontSize: "16px",
  fontFamily: "'Inter', 'Segoe UI', sans-serif",

  // Colors
  messageColor: "#ffffff",
  usernameColor: "#a970ff",       // Twitch purple default
  backgroundColor: "rgba(0, 0, 0, 0.5)",

  // Badge size
  badgeSize: "18px",

  // Animation duration for slide-in / fade-out
  animationDuration: "0.3s",

  // Feature toggles
  showBadges: true,
  showTimestamps: false,
  highlightMentions: true,
  mentionColor: "#ffb31a",

  // Fade message after N seconds (0 = never fade)
  fadeMessageAfter: 0,

  // Show sub / raid / gift alerts in the chat overlay
  showAlerts: true,

  // Adds a subtle text shadow for legibility on bright backgrounds
  textShadow: true,

  // Maximum width of the chat container
  maxWidth: "340px",

  // Maximum height of the chat container
  chatHeight: "600px",

  // Position of the overlay — accepts: bottom-left, bottom-right, top-left, top-right
  position: "bottom-left",
};
