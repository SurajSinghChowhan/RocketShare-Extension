# RocketShare Extension

RocketShare is a browser extension + mobile client + signaling server system that lets you share media files from a mobile device to a desktop by scanning a QR code. Transfer is peer-to-peer using WebRTC data channels, with a signaling server (and optional TURN relay) for connectivity. 

---

## Table of Contents

- [Features](#features)  
- [Architecture](#architecture)  
- [Getting Started](#getting-started)  
  - [Prerequisites](#prerequisites)  
  - [Setup](#setup)  
  - [Running Locally](#running-locally)  
- [Usage](#usage)  
- [Security & Privacy](#security--privacy)  
- [Tips & Best Practices](#tips--best-practices)  
- [Contributing](#contributing)  
- [License](#license)  

---

## Features

- QR code based session pairing  
- Peer-to-peer file transfer (no server storage of files)  
- Works across desktop & mobile browsers  
- TURN server fallback for NAT/firewall issues  
- Chunked file transfers to support large media  

---

## Architecture

Here’s how the system is structured:

- **Desktop (Extension)**: Generates QR code, creates WebRTC offer, receives chunks, reconstructs file blob, provides download.  
- **Mobile Client**: Scans QR code, connects to signaling server, selects media, sends metadata + file chunks via DataChannel.  
- **Signaling Server**: Node.js WebSocket server only used to exchange signaling data (SDP, ICE candidates).  
- **TURN server**: Optional, used when direct peer connection fails.  

---

## Getting Started

### Prerequisites

- Node.js (>= v14)  
- Git  
- Browser (Chrome recommended for extension testing)  
- A TURN server (optional, recommended if testing across restrictive networks)  

### Setup

```bash
# Clone repo
git clone https://github.com/SurajSinghChowhan/RocketShare-Extension.git
cd RocketShare-Extension

# Install dependencies (if any)
cd signaling-server
npm install

# (Optional) Setup TURN server settings in config
# e.g. add TURN server URL and credentials in your config file or environment
