# ELITE1:1 - Premium E-commerce Platform

A premium e-commerce platform for exclusive 1:1 clothing, featuring real-time inventory management, customer reviews, and direct Telegram support.

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- A Firebase project

### Installation

1. Clone the repository:
   ```bash
   git clone <your-repo-url>
   cd elite-1-1
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   - Copy `.env.example` to `.env`
   - Fill in your `VITE_ADMIN_EMAIL` and other required variables.

4. Set up Firebase:
   - Create a new project in the [Firebase Console](https://console.firebase.google.com/).
   - Enable **Authentication** (Google Sign-In).
   - Create a **Firestore Database**.
   - Copy your Firebase configuration and save it as `firebase-applet-config.json` in the root directory.

   Example `firebase-applet-config.json`:
   ```json
   {
     "apiKey": "YOUR_API_KEY",
     "authDomain": "YOUR_AUTH_DOMAIN",
     "projectId": "YOUR_PROJECT_ID",
     "storageBucket": "YOUR_STORAGE_BUCKET",
     "messagingSenderId": "YOUR_MESSAGING_SENDER_ID",
     "appId": "YOUR_APP_ID",
     "firestoreDatabaseId": "(default)"
   }
   ```

5. Deploy Firestore Rules:
   - Use the rules provided in `firestore.rules`.

### Development

Run the development server:
```bash
npm run dev
```
The app will be available at `http://localhost:3000`.

### Building for Production

To create a production build:
```bash
npm run build
```
The output will be in the `dist/` directory.

## 🛠️ Tech Stack

- **Frontend:** React, Vite, Tailwind CSS, Lucide React, Framer Motion
- **Backend:** Firebase (Firestore, Authentication)
- **State Management:** React Context API

## 🔒 Security

This project uses Firestore Security Rules to protect data. Ensure you deploy the rules in `firestore.rules` to your Firebase project.

## 📄 License

This project is licensed under the Apache-2.0 License - see the LICENSE file for details.
