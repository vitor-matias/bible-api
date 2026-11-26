// A PUT /v1/mais365/reminders body that passes validation.
export const validReminderBody = () => ({
  subscription: {
    endpoint: "https://push.example.com/send/abc",
    keys: {
      p256dh: Buffer.alloc(65, 4).toString("base64url"),
      auth: Buffer.alloc(16, 1).toString("base64url"),
    },
  },
  time: "08:30",
  timeZone: "Europe/Lisbon",
  readOn: "2026-11-25",
  next: { day: 121, title: "Ciclo de violência" },
})
