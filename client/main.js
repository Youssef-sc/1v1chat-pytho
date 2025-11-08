// ============================================================================
// Configuration & State
// ============================================================================
const ICE_CONFIG = { 
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ] 
};

const state = {
    socket: null,
    localStream: null,
    peerConnection: null,
    partnerId: null,
    isInitiator: false,
    isConnected: false,
    videoEnabled: true,
    audioEnabled: true
};

const elements = {
    landingStartBtn: document.getElementById('landingStartBtn'),
    heroStartBtn: document.getElementById('heroStartBtn'),
    landingPage: document.getElementById('landingPage'),
    chatPage: document.getElementById('chatPage'),
    localVideo: document.getElementById('localVideo'),
    remoteVideo: document.getElementById('remoteVideo'),
    remotePlaceholder: document.getElementById('remotePlaceholder'),
    chatInput: document.getElementById('chatInput'),
    sendBtn: document.getElementById('sendBtn'),
    clearChatBtn: document.getElementById('clearChatBtn'),
    chatMessages: document.getElementById('chatMessages'),
    nextBtn: document.getElementById('nextBtn'),
    stopBtn: document.getElementById('stopBtn'),
    toggleVideoBtn: document.getElementById('toggleVideoBtn'),
    toggleAudioBtn: document.getElementById('toggleAudioBtn'),
    reportBtn: document.getElementById('reportBtn'),
    reportModal: document.getElementById('reportModal'),
    closeReportModal: document.getElementById('closeReportModal'),
    submitReportBtn: document.getElementById('submitReportBtn'),
    cancelReportBtn: document.getElementById('cancelReportBtn'),
    toastContainer: document.getElementById('toastContainer'),
    statusText: document.querySelector('.status-text'),
    statusDot: document.querySelector('.status-dot')
};

// ============================================================================
// Utility Functions
// ============================================================================
function showToast(msg, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    elements.toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function updateStatus(msg, status = 'waiting') {
    if (elements.statusText) {
        elements.statusText.textContent = msg;
    }
    if (elements.statusDot) {
        elements.statusDot.className = 'status-dot ' + status;
    }
}

function addChatMessage(msg, sent = false) {
    const div = document.createElement('div');
    div.className = 'chat-message ' + (sent ? 'sent' : 'received');
    div.textContent = msg;
    
    const span = document.createElement('span');
    span.className = 'timestamp';
    span.textContent = new Date().toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    div.appendChild(span);
    elements.chatMessages.appendChild(div);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

// ============================================================================
// Media Functions
// ============================================================================
async function startLocalMedia() {
    try {
        state.localStream = await navigator.mediaDevices.getUserMedia({
            video: { 
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true
            }
        });
        
        elements.localVideo.srcObject = state.localStream;
        updateStatus('Ready to connect', 'waiting');
        return true;
    } catch (error) {
        console.error('Media error:', error);
        
        let errorMessage = 'Cannot access camera/microphone';
        if (error.name === 'NotAllowedError') {
            errorMessage = 'Please allow camera and microphone access';
        } else if (error.name === 'NotFoundError') {
            errorMessage = 'No camera or microphone found';
        }
        
        showToast(errorMessage, 'error');
        return false;
    }
}

function stopLocalMedia() {
    if (state.localStream) {
        state.localStream.getTracks().forEach(track => track.stop());
        elements.localVideo.srcObject = null;
        state.localStream = null;
    }
}

function toggleVideo() {
    if (state.localStream) {
        const videoTrack = state.localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            state.videoEnabled = videoTrack.enabled;
            elements.toggleVideoBtn.classList.toggle('off', !videoTrack.enabled);
            showToast(videoTrack.enabled ? 'Camera on' : 'Camera off', 'info');
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
            showToast(audioTrack.enabled ? 'Microphone on' : 'Microphone muted', 'info');
        }
    }
}

// ============================================================================
// WebRTC Functions
// ============================================================================
function createPeerConnection() {
    if (state.peerConnection) return;
    
    state.peerConnection = new RTCPeerConnection(ICE_CONFIG);
    
    // Add local tracks to peer connection
    state.localStream.getTracks().forEach(track => {
        state.peerConnection.addTrack(track, state.localStream);
    });
    
    // Handle incoming remote tracks
    state.peerConnection.ontrack = (event) => {
        console.log('Received remote track');
        elements.remoteVideo.srcObject = event.streams[0];
        elements.remotePlaceholder.classList.add('hidden');
        updateStatus('Connected', 'connected');
        state.isConnected = true;
        elements.chatInput.disabled = false;
        elements.sendBtn.disabled = false;
        elements.reportBtn.disabled = false;
    };
    
    // Handle ICE candidates
    state.peerConnection.onicecandidate = (event) => {
        if (event.candidate && state.partnerId) {
            state.socket.emit('signal', {
                to: state.partnerId,
                data: { type: 'ice', candidate: event.candidate }
            });
        }
    };
    
    // Handle connection state changes
    state.peerConnection.onconnectionstatechange = () => {
        const connectionState = state.peerConnection.connectionState;
        console.log('Connection state:', connectionState);
        
        switch (connectionState) {
            case 'connected':
                updateStatus('Connected', 'connected');
                showToast('Connected!', 'success');
                break;
            case 'disconnected':
                updateStatus('Partner disconnected', 'waiting');
                state.isConnected = false;
                break;
            case 'failed':
                updateStatus('Connection failed', 'error');
                showToast('Connection failed. Finding new partner...', 'error');
                cleanupPeerConnection();
                setTimeout(() => {
                    if (state.socket) {
                        state.socket.emit('join');
                    }
                }, 1000);
                break;
            case 'closed':
                updateStatus('Connection closed', 'waiting');
                state.isConnected = false;
                break;
        }
    };
    
    // Handle ICE connection state
    state.peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE state:', state.peerConnection.iceConnectionState);
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
    elements.chatInput.disabled = true;
    elements.sendBtn.disabled = true;
    elements.reportBtn.disabled = true;
    elements.chatMessages.innerHTML = '';
}

async function createAndSendOffer() {
    try {
        state.isInitiator = true;
        console.log('Creating offer...');
        const offer = await state.peerConnection.createOffer();
        await state.peerConnection.setLocalDescription(offer);
        
        state.socket.emit('signal', {
            to: state.partnerId,
            data: { type: 'offer', sdp: offer }
        });
        console.log('Offer sent');
    } catch (error) {
        console.error('Offer error:', error);
        showToast('Failed to create connection', 'error');
    }
}

async function handleOffer(from, sdp) {
    try {
        if (!state.peerConnection) {
            createPeerConnection();
        }
        
        console.log('Handling offer from', from);
        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
        
        const answer = await state.peerConnection.createAnswer();
        await state.peerConnection.setLocalDescription(answer);
        
        state.socket.emit('signal', {
            to: from,
            data: { type: 'answer', sdp: answer }
        });
        console.log('Answer sent');
    } catch (error) {
        console.error('Handle offer error:', error);
    }
}

async function handleAnswer(sdp) {
    try {
        console.log('Handling answer');
        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    } catch (error) {
        console.error('Handle answer error:', error);
    }
}

async function handleIceCandidate(candidate) {
    try {
        if (state.peerConnection && state.peerConnection.remoteDescription) {
            await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
    } catch (error) {
        console.error('ICE candidate error:', error);
    }
}

// ============================================================================
// Chat Functions
// ============================================================================
function sendChatMessage() {
    const message = elements.chatInput.value.trim();
    if (!message || !state.isConnected) return;
    
    addChatMessage(message, true);
    state.socket.emit('chat_message', { message: message });
    elements.chatInput.value = '';
}

function clearChat() {
    elements.chatMessages.innerHTML = '';
    showToast('Chat cleared', 'info');
}

// ============================================================================
// Report Functions
// ============================================================================
function openReportModal() {
    elements.reportModal.classList.remove('hidden');
}

function closeReportModal() {
    elements.reportModal.classList.add('hidden');
    document.getElementById('reportReason').value = 'inappropriate';
    document.getElementById('reportDetails').value = '';
}

function submitReport() {
    const reason = document.getElementById('reportReason').value;
    const details = document.getElementById('reportDetails').value;
    
    console.log('Report submitted:', {
        partnerId: state.partnerId,
        reason: reason,
        details: details,
        timestamp: new Date().toISOString()
    });
    
    showToast('Report submitted. Thank you for keeping our community safe.', 'success');
    closeReportModal();
    
    // Disconnect from reported user and find new partner
    setTimeout(() => {
        elements.nextBtn.click();
    }, 500);
}

// ============================================================================
// Socket.IO Event Handlers
// ============================================================================
function setupSocket() {
    state.socket = io();
    
    state.socket.on('connect', () => {
        console.log('Connected to server');
        showToast('Connected to server', 'success');
    });
    
    state.socket.on('disconnect', () => {
        console.log('Disconnected from server');
        showToast('Disconnected from server', 'error');
    });
    
    state.socket.on('matched', async (data) => {
        console.log('Matched with partner:', data.peer);
        state.partnerId = data.peer;
        
        createPeerConnection();
        
        // Lower socket ID initiates the offer
        if (state.socket.id < state.partnerId) {
            await createAndSendOffer();
        }
        
        elements.nextBtn.disabled = false;
        showToast('Partner found!', 'success');
        updateStatus('Connecting...', 'waiting');
    });
    
    state.socket.on('signal', async ({ from, data }) => {
        if (data.type === 'offer') {
            await handleOffer(from, data.sdp);
        } else if (data.type === 'answer') {
            await handleAnswer(data.sdp);
        } else if (data.type === 'ice') {
            await handleIceCandidate(data.candidate);
        }
    });
    
    state.socket.on('chat_message', (data) => {
        addChatMessage(data.message, false);
    });
    
    state.socket.on('partner_left', () => {
        showToast('Partner left the chat', 'info');
        updateStatus('Partner left', 'waiting');
        cleanupPeerConnection();
        
        // Automatically search for new partner
        setTimeout(() => {
            updateStatus('Finding new partner...', 'waiting');
            state.socket.emit('join');
        }, 1000);
    });
    
    state.socket.on('partner_disconnected', () => {
        showToast('Partner disconnected', 'info');
        updateStatus('Partner disconnected', 'waiting');
        cleanupPeerConnection();
    });
    
    state.socket.on('status', (data) => {
        if (data.msg === 'waiting') {
            updateStatus('Waiting for partner...', 'waiting');
        }
    });
    
    state.socket.on('error', (data) => {
        console.error('Server error:', data);
        showToast(data.msg || 'An error occurred', 'error');
    });
}

// ============================================================================
// Event Listeners
// ============================================================================

// Start chat function
async function startChat() {
    // Disable all start buttons
    elements.landingStartBtn.disabled = true;
    if (elements.heroStartBtn) {
        elements.heroStartBtn.disabled = true;
    }
    
    // Try to get media access
    const mediaOk = await startLocalMedia();
    
    if (mediaOk) {
        // Hide landing page, show chat page
        elements.landingPage.classList.add('hidden');
        elements.chatPage.classList.remove('hidden');
        
        // Connect to server and start matching
        setupSocket();
        state.socket.emit('join');
        updateStatus('Finding partner...', 'waiting');
    } else {
        // Re-enable buttons if media access failed
        elements.landingStartBtn.disabled = false;
        if (elements.heroStartBtn) {
            elements.heroStartBtn.disabled = false;
        }
    }
}

// Landing page buttons
elements.landingStartBtn.addEventListener('click', startChat);
if (elements.heroStartBtn) {
    elements.heroStartBtn.addEventListener('click', startChat);
}

// Next button - find new partner
elements.nextBtn.addEventListener('click', () => {
    cleanupPeerConnection();
    state.socket.emit('leave');
    updateStatus('Finding new partner...', 'waiting');
    
    setTimeout(() => {
        state.socket.emit('join');
    }, 100);
});

// Stop button - return to landing page
elements.stopBtn.addEventListener('click', () => {
    // Disconnect from socket
    if (state.socket) {
        state.socket.emit('leave');
        state.socket.disconnect();
        state.socket = null;
    }
    
    // Clean up connections and media
    cleanupPeerConnection();
    stopLocalMedia();
    
    // Show landing page
    elements.landingPage.classList.remove('hidden');
    elements.chatPage.classList.add('hidden');
    
    // Re-enable start buttons
    elements.landingStartBtn.disabled = false;
    if (elements.heroStartBtn) {
        elements.heroStartBtn.disabled = false;
    }
    
    showToast('Chat ended', 'info');
});

// Media control buttons
elements.toggleVideoBtn.addEventListener('click', toggleVideo);
elements.toggleAudioBtn.addEventListener('click', toggleAudio);

// Chat controls
elements.sendBtn.addEventListener('click', sendChatMessage);
elements.clearChatBtn.addEventListener('click', clearChat);

elements.chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
    }
});

// Report modal
elements.reportBtn.addEventListener('click', openReportModal);
elements.closeReportModal.addEventListener('click', closeReportModal);

if (elements.cancelReportBtn) {
    elements.cancelReportBtn.addEventListener('click', closeReportModal);
}

elements.submitReportBtn.addEventListener('click', submitReport);

// Close modal when clicking outside
elements.reportModal?.addEventListener('click', (e) => {
    if (e.target === elements.reportModal) {
        closeReportModal();
    }
});

// Prevent accidental page close
window.addEventListener('beforeunload', (e) => {
    if (state.isConnected) {
        e.preventDefault();
        e.returnValue = '';
    }
});

// Log when page is loaded
console.log('1v1Chat initialized successfully');