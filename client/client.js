// ============================================================================
// Configuration & Constants
// ============================================================================

const ICE_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.services.mozilla.com' }
    ]
};

// ============================================================================
// State Management
// ============================================================================

const state = {
    socket: null,
    localStream: null,
    peerConnection: null,
    partnerId: null,
    isInitiator: false,
    isConnected: false,
    videoEnabled: true,
    audioEnabled: true,
    chatMessages: []
};

// ============================================================================
// DOM Elements
// ============================================================================

const elements = {
    // Pages
    landingPage: document.getElementById('landingPage'),
    chatPage: document.getElementById('chatPage'),
    
    // Landing
    landingStartBtn: document.getElementById('landingStartBtn'),
    onlineUsersLanding: document.getElementById('onlineUsersLanding'),
    
    // Header
    onlineUsers: document.getElementById('onlineUsers'),
    
    // Videos
    localVideo: document.getElementById('localVideo'),
    remoteVideo: document.getElementById('remoteVideo'),
    remotePlaceholder: document.getElementById('remotePlaceholder'),
    connectionStatus: document.getElementById('connectionStatus'),
    
    // Chat
    chatMessages: document.getElementById('chatMessages'),
    chatInput: document.getElementById('chatInput'),
    sendBtn: document.getElementById('sendBtn'),
    clearChatBtn: document.getElementById('clearChatBtn'),
    
    // Controls
    nextBtn: document.getElementById('nextBtn'),
    stopBtn: document.getElementById('stopBtn'),
    toggleVideoBtn: document.getElementById('toggleVideoBtn'),
    toggleAudioBtn: document.getElementById('toggleAudioBtn'),
    reportBtn: document.getElementById('reportBtn'),
    
    // Status
    statusMessage: document.getElementById('statusMessage'),
    
    // Modal
    reportModal: document.getElementById('reportModal'),
    closeReportModal: document.getElementById('closeReportModal'),
    submitReportBtn: document.getElementById('submitReportBtn'),
    
    // Toast
    toastContainer: document.getElementById('toastContainer')
};

// ============================================================================
// Utility Functions
// ============================================================================

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div class="toast-icon">${
            type === 'success' ? '✓' :
            type === 'error' ? '✕' :
            'ℹ'
        }</div>
        <div class="toast-message">${message}</div>
    `;
    
    elements.toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'toastSlideOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function updateStatus(message, status = 'waiting') {
    elements.statusMessage.textContent = message;
    
    const statusDot = elements.connectionStatus.querySelector('.status-dot');
    if (statusDot) {
        statusDot.className = 'status-dot ' + status;
    }
    
    const statusText = elements.connectionStatus.querySelector('span:last-child');
    if (statusText) {
        statusText.textContent = message;
    }
}

function updateOnlineCount(count) {
    if (elements.onlineUsers) {
        elements.onlineUsers.textContent = count;
    }
    if (elements.onlineUsersLanding) {
        elements.onlineUsersLanding.textContent = count;
    }
}

function formatTime(date) {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

// ============================================================================
// Page Navigation
// ============================================================================

function showLandingPage() {
    elements.landingPage.classList.remove('hidden');
    elements.chatPage.classList.add('hidden');
}

function showChatPage() {
    elements.landingPage.classList.add('hidden');
    elements.chatPage.classList.remove('hidden');
}

// ============================================================================
// Media Stream Functions
// ============================================================================

async function startLocalMedia() {
    try {
        updateStatus('Requesting camera and microphone access...');
        
        state.localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        elements.localVideo.srcObject = state.localStream;
        updateStatus('Ready to connect');
        return true;
        
    } catch (error) {
        console.error('Media access error:', error);
        
        let errorMessage = 'Camera/microphone access denied';
        if (error.name === 'NotFoundError') {
            errorMessage = 'No camera or microphone found';
        } else if (error.name === 'NotAllowedError') {
            errorMessage = 'Please allow camera and microphone access';
        } else if (error.name === 'NotReadableError') {
            errorMessage = 'Camera/microphone is being used by another application';
        }
        
        showToast(errorMessage, 'error');
        return false;
    }
}

function stopLocalMedia() {
    if (state.localStream) {
        state.localStream.getTracks().forEach(track => track.stop());
        state.localStream = null;
        elements.localVideo.srcObject = null;
    }
}

function toggleVideo() {
    if (state.localStream) {
        const videoTrack = state.localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            state.videoEnabled = videoTrack.enabled;
            elements.toggleVideoBtn.classList.toggle('off', !videoTrack.enabled);
            
            showToast(
                videoTrack.enabled ? 'Camera turned on' : 'Camera turned off',
                'info'
            );
        }
    }
}

function toggleAudio() {
    if (state.localStream) {
        const audioTrack = state.localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            state.audioEnabled = audioTrack.enabled;
            elements.toggleAudioBtn.classList.toggle('off', !audioTrack.enabled);
            
            showToast(
                audioTrack.enabled ? 'Microphone unmuted' : 'Microphone muted',
                'info'
            );
        }
    }
}

// ============================================================================
// WebRTC Peer Connection
// ============================================================================

function createPeerConnection() {
    if (state.peerConnection) {
        console.warn('Peer connection already exists');
        return;
    }

    console.log('Creating peer connection...');
    state.peerConnection = new RTCPeerConnection(ICE_CONFIG);

    // Add local tracks
    if (state.localStream) {
        state.localStream.getTracks().forEach(track => {
            state.peerConnection.addTrack(track, state.localStream);
            console.log(`Added ${track.kind} track`);
        });
    }

    // Handle incoming tracks
    state.peerConnection.ontrack = (event) => {
        console.log('Received remote track:', event.track.kind);
        elements.remoteVideo.srcObject = event.streams[0];
        elements.remotePlaceholder.classList.add('hidden');
        updateStatus('Connected', 'connected');
        state.isConnected = true;
        
        // Enable chat and report
        elements.chatInput.disabled = false;
        elements.sendBtn.disabled = false;
        elements.reportBtn.disabled = false;
    };

    // Handle ICE candidates
    state.peerConnection.onicecandidate = (event) => {
        if (event.candidate && state.partnerId) {
            console.log('Sending ICE candidate');
            state.socket.emit('signal', {
                to: state.partnerId,
                data: {
                    type: 'ice',
                    candidate: event.candidate
                }
            });
        }
    };

    // Handle connection state
    state.peerConnection.onconnectionstatechange = () => {
        const connectionState = state.peerConnection.connectionState;
        console.log('Connection state:', connectionState);
        
        switch (connectionState) {
            case 'connected':
                updateStatus('Connected', 'connected');
                showToast('Connected successfully!', 'success');
                break;
            case 'disconnected':
                updateStatus('Partner disconnected', 'waiting');
                state.isConnected = false;
                break;
            case 'failed':
                updateStatus('Connection failed', 'error');
                showToast('Connection failed. Finding new partner...', 'error');
                cleanupPeerConnection();
                if (state.socket.connected) {
                    setTimeout(() => state.socket.emit('join'), 1000);
                }
                break;
            case 'closed':
                updateStatus('Connection closed', 'waiting');
                state.isConnected = false;
                break;
        }
    };

    // Handle ICE connection state
    state.peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', state.peerConnection.iceConnectionState);
    };
}

function cleanupPeerConnection() {
    if (state.peerConnection) {
        state.peerConnection.close();
        state.peerConnection = null;
    }
    
    elements.remoteVideo.srcObject = null;
    elements.remotePlaceholder.classList.remove('hidden');
    state.partnerId = null;
    state.isInitiator = false;
    state.isConnected = false;
    
    // Disable chat and report
    elements.chatInput.disabled = true;
    elements.sendBtn.disabled = true;
    elements.reportBtn.disabled = true;
    
    // Clear chat
    clearChat();
}

async function createAndSendOffer() {
    try {
        state.isInitiator = true;
        console.log('Creating offer...');
        updateStatus('Connecting to partner...', 'waiting');
        
        const offer = await state.peerConnection.createOffer();
        await state.peerConnection.setLocalDescription(offer);
        
        state.socket.emit('signal', {
            to: state.partnerId,
            data: {
                type: 'offer',
                sdp: offer
            }
        });
        
        console.log('Offer sent');
        
    } catch (error) {
        console.error('Error creating offer:', error);
        showToast('Failed to create connection', 'error');
    }
}

async function handleOffer(from, sdp) {
    try {
        console.log('Received offer from', from);
        
        if (!state.peerConnection) {
            createPeerConnection();
        }
        
        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
        
        const answer = await state.peerConnection.createAnswer();
        await state.peerConnection.setLocalDescription(answer);
        
        state.socket.emit('signal', {
            to: from,
            data: {
                type: 'answer',
                sdp: answer
            }
        });
        
        console.log('Answer sent');
        
    } catch (error) {
        console.error('Error handling offer:', error);
        showToast('Failed to connect', 'error');
    }
}

async function handleAnswer(sdp) {
    try {
        console.log('Received answer');
        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    } catch (error) {
        console.error('Error handling answer:', error);
    }
}

async function handleIceCandidate(candidate) {
    try {
        if (state.peerConnection && state.peerConnection.remoteDescription) {
            await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            console.log('ICE candidate added');
        }
    } catch (error) {
        console.warn('Error adding ICE candidate:', error);
    }
}

// ============================================================================
// Chat Functions
// ============================================================================

function addChatMessage(message, isSent = false) {
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${isSent ? 'sent' : 'received'}`;
    
    const text = document.createElement('div');
    text.textContent = message;
    
    const timestamp = document.createElement('span');
    timestamp.className = 'timestamp';
    timestamp.textContent = formatTime(new Date());
    
    messageEl.appendChild(text);
    messageEl.appendChild(timestamp);
    
    elements.chatMessages.appendChild(messageEl);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function sendChatMessage() {
    const message = elements.chatInput.value.trim();
    
    if (!message || !state.isConnected) return;
    
    // Add to UI
    addChatMessage(message, true);
    
    // Send to partner
    state.socket.emit('chat_message', {
        message: message
    });
    
    // Clear input
    elements.chatInput.value = '';
}

function clearChat() {
    elements.chatMessages.innerHTML = '';
}

// ============================================================================
// Socket.IO Event Handlers
// ============================================================================

function setupSocketListeners() {
    state.socket.on('connect', () => {
        console.log('Connected to server. Socket ID:', state.socket.id);
        showToast('Connected to server', 'success');
    });

    state.socket.on('disconnect', (reason) => {
        console.log('Disconnected from server:', reason);
        showToast('Disconnected from server', 'error');
        cleanupPeerConnection();
    });

    state.socket.on('status', (data) => {
        if (data && data.msg === 'waiting') {
            updateStatus('Waiting for a partner...', 'waiting');
            const position = data.queue_position || '';
            if (position) {
                updateStatus(`Waiting... (Position: ${position})`, 'waiting');
            }
        }
    });

    state.socket.on('matched', async (payload) => {
        state.partnerId = payload.peer;
        console.log('Matched with:', state.partnerId);
        
        updateStatus('Found a partner! Connecting...', 'waiting');
        showToast('Partner found!', 'success');
        
        elements.nextBtn.disabled = false;
        
        if (!state.peerConnection) {
            createPeerConnection();
        }
        
        // Determine initiator
        if (state.socket.id < state.partnerId) {
            await createAndSendOffer();
        }
    });

    state.socket.on('signal', async ({ from, data }) => {
        if (!from || !data) return;
        
        console.log(`Received signal: ${data.type}`);
        
        switch (data.type) {
            case 'offer':
                await handleOffer(from, data.sdp);
                break;
            case 'answer':
                await handleAnswer(data.sdp);
                break;
            case 'ice':
                await handleIceCandidate(data.candidate);
                break;
        }
    });

    state.socket.on('chat_message', ({ message, timestamp }) => {
        addChatMessage(message, false);
    });

    state.socket.on('partner_left', () => {
        console.log('Partner left');
        showToast('Partner left the chat', 'info');
        updateStatus('Partner left. Finding new...', 'waiting');
        cleanupPeerConnection();
        state.socket.emit('join');
    });

    state.socket.on('partner_disconnected', () => {
        console.log('Partner disconnected');
        showToast('Partner disconnected', 'info');
        updateStatus('Partner disconnected. Finding new...', 'waiting');
        cleanupPeerConnection();
        state.socket.emit('join');
    });

    state.socket.on('left', () => {
        cleanupPeerConnection();
    });

    state.socket.on('report_received', () => {
        showToast('Report submitted. Thank you.', 'success');
    });

    state.socket.on('error', (data) => {
        console.error('Server error:', data);
        showToast(data.msg || 'An error occurred', 'error');
    });
}

// Fetch online users periodically
function updateOnlineUsers() {
    fetch('/stats')
        .then(res => res.json())
        .then(data => {
            updateOnlineCount(data.active_users || 0);
        })
        .catch(err => console.error('Failed to fetch stats:', err));
}

// ============================================================================
// Event Listeners
// ============================================================================

// Landing page start
elements.landingStartBtn.addEventListener('click', async () => {
    elements.landingStartBtn.disabled = true;
    elements.landingStartBtn.innerHTML = '<span>Starting...</span>';
    
    const success = await startLocalMedia();
    
    if (success) {
        showChatPage();
        
        // Connect to socket
        state.socket = io();
        setupSocketListeners();
        
        // Join matchmaking
        state.socket.emit('join');
        
        updateStatus('Finding a partner...', 'waiting');
    } else {
        elements.landingStartBtn.disabled = false;
        elements.landingStartBtn.innerHTML = '<span>Start Chatting Now</span>';
    }
});

// Next button
elements.nextBtn.addEventListener('click', () => {
    console.log('Finding next partner...');
    updateStatus('Finding next partner...', 'waiting');
    
    cleanupPeerConnection();
    state.socket.emit('leave');
    
    setTimeout(() => {
        state.socket.emit('join');
    }, 100);
});

// Stop button
elements.stopBtn.addEventListener('click', () => {
    console.log('Stopping...');
    
    if (state.socket) {
        state.socket.emit('leave');
        state.socket.disconnect();
        state.socket = null;
    }
    
    cleanupPeerConnection();
    stopLocalMedia();
    
    showLandingPage();
    elements.landingStartBtn.disabled = false;
    elements.landingStartBtn.innerHTML = '<span>Start Chatting Now</span><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
});

// Toggle video
elements.toggleVideoBtn.addEventListener('click', toggleVideo);

// Toggle audio
elements.toggleAudioBtn.addEventListener('click', toggleAudio);

// Send chat message
elements.sendBtn.addEventListener('click', sendChatMessage);

elements.chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendChatMessage();
    }
});

// Clear chat
elements.clearChatBtn.addEventListener('click', clearChat);

// Report button
elements.reportBtn.addEventListener('click', () => {
    elements.reportModal.classList.remove('hidden');
});

// Close report modal
elements.closeReportModal.addEventListener('click', () => {
    elements.reportModal.classList.add('hidden');
});

// Report reason selection
document.querySelectorAll('input[name="reportReason"]').forEach(radio => {
    radio.addEventListener('change', () => {
        elements.submitReportBtn.disabled = false;
    });
});

// Submit report
elements.submitReportBtn.addEventListener('click', () => {
    const reason = document.querySelector('input[name="reportReason"]:checked')?.value;
    
    if (reason && state.partnerId) {
        state.socket.emit('report', { reason });
        elements.reportModal.classList.add('hidden');
        
        // Reset form
        document.querySelectorAll('input[name="reportReason"]').forEach(r => r.checked = false);
        elements.submitReportBtn.disabled = true;
        
        // Skip to next
        cleanupPeerConnection();
        state.socket.emit('leave');
        setTimeout(() => state.socket.emit('join'), 100);
    }
});

// Close modal on outside click
elements.reportModal.addEventListener('click', (e) => {
    if (e.target === elements.reportModal) {
        elements.reportModal.classList.add('hidden');
    }
});

// Handle page unload
window.addEventListener('beforeunload', () => {
    if (state.socket && state.socket.connected) {
        state.socket.emit('leave');
        state.socket.disconnect();
    }
    stopLocalMedia();
    cleanupPeerConnection();
});

// ============================================================================
// Initialization
// ============================================================================

console.log('ChatRoulette client initialized');

// Update online users every 10 seconds
updateOnlineUsers();
setInterval(updateOnlineUsers, 10000);