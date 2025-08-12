import express from "express";
import multer from "multer";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import OpenAI from "openai";
import { v2 as cloudinary } from "cloudinary";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer for local temp storage before upload to Cloudinary
const upload = multer({ dest: "uploads/" });

// SQLite DB setup
const db = await open({
  filename: "./database.db",
  driver: sqlite3.Database,
});

await db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  pin_hash TEXT
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_url TEXT,
  caption TEXT,
  approved INTEGER DEFAULT 0,
  comments TEXT
);
`);

// OpenAI setup
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Nodemailer (Outlook SMTP)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/register", async (req, res) => {
  const { username, pin } = req.body;
  const pinHash = await bcrypt.hash(pin, 10);
  try {
    await db.run("INSERT INTO users (username, pin_hash) VALUES (?, ?)", [
      username,
      pinHash,
    ]);
    res.json({ success: true });
  } catch {
    res.json({ success: false, message: "Username already exists" });
  }
});

app.post("/login", async (req, res) => {
  const { username, pin } = req.body;
  const user = await db.get("SELECT * FROM users WHERE username = ?", [
    username,
  ]);
  if (user && (await bcrypt.compare(pin, user.pin_hash))) {
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

app.post("/upload", upload.single("media"), async (req, res) => {
  const { caption } = req.body;
  const filePath = req.file.path;

  try {
    const cloudRes = await cloudinary.uploader.upload(filePath, {
      resource_type: "auto",
    });
    await db.run("INSERT INTO posts (media_url, caption) VALUES (?, ?)", [
      cloudRes.secure_url,
      caption,
    ]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

app.get("/posts", async (req, res) => {
  const posts = await db.all("SELECT * FROM posts");
  res.json(posts);
});

app.post("/approve", async (req, res) => {
  const { id } = req.body;
  await db.run("UPDATE posts SET approved = 1 WHERE id = ?", [id]);

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: process.env.NOTIFY_EMAIL,
    subject: "Post Approved",
    text: `Post ID ${id} has been approved.`,
  });

  res.json({ success: true });
});

app.post("/comment", async (req, res) => {
  const { id, comment } = req.body;
  await db.run("UPDATE posts SET comments = ? WHERE id = ?", [comment, id]);

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: process.env.NOTIFY_EMAIL,
    subject: "New Comment",
    text: `Comment on post ${id}: ${comment}`,
  });

  res.json({ success: true });
});

app.post("/generate-caption", async (req, res) => {
  const { promptText } = req.body;
  try {
    const completion = await openai.completions.create({
      model: "text-davinci-003",
      prompt: `Write an Instagram/TikTok caption for an electrical business. Focus on engagement, clarity, and relevance. Context: ${promptText}`,
      max_tokens: 50,
      temperature: 0.7,
    });
    res.json({ caption: completion.choices[0].text.trim() });
  } catch (err) {
    console.error(err);
    res.json({ caption: "" });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
