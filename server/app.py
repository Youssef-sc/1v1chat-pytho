# server/app.py
import os
from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import redis
from dotenv import load_dotenv
import logging

load_dotenv()

# Configuration
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
PORT = int(os.getenv("PORT", 5500))

# Redis client
r = redis.from_url(REDIS_URL, decode_responses=True)

# Flask app setup
app = Flask(__name__, static_folder="../client", static_url_path="/")
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="threading",
    message_queue=REDIS_URL
)

# Redis keys
WAITING_LIST_KEY = "waiting_queue"
PARTNER_MAP_KEY = "partner_map"
ROOM_MAP_KEY = "room_map"

# Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ============================================================================
# Helper Functions
# ============================================================================

def push_waiting(sid):
    """Add user to waiting queue"""
    r.rpush(WAITING_LIST_KEY, sid)
    logger.info(f"Added {sid} to waiting queue")


def pop_waiting():
    """Remove and return first user from waiting queue"""
    return r.lpop(WAITING_LIST_KEY)


def remove_waiting(sid):
    """Remove user from waiting queue (if present)"""
    removed = r.lrem(WAITING_LIST_KEY, 0, sid)
    if removed:
        logger.info(f"Removed {sid} from waiting queue")
    return removed


def set_partner(sid, partner_sid):
    """Store partner relationship"""
    r.hset(PARTNER_MAP_KEY, sid, partner_sid)
    r.hset(PARTNER_MAP_KEY, partner_sid, sid)


def get_partner(sid):
    """Get partner for a given sid"""
    return r.hget(PARTNER_MAP_KEY, sid)


def clear_partner(sid):
    """Remove partner relationships"""
    partner = get_partner(sid)
    if partner:
        r.hdel(PARTNER_MAP_KEY, partner)
    r.hdel(PARTNER_MAP_KEY, sid)
    return partner


def set_room(sid, room_name):
    """Store room mapping"""
    r.hset(ROOM_MAP_KEY, sid, room_name)


def get_room(sid):
    """Get room for a given sid"""
    return r.hget(ROOM_MAP_KEY, sid)


def clear_room(sid):
    """Remove room mapping"""
    room = get_room(sid)
    if room:
        r.hdel(ROOM_MAP_KEY, sid)
    return room


# ============================================================================
# Socket Event Handlers
# ============================================================================

@app.route("/")
def index():
    """Serve main HTML page"""
    return send_from_directory(app.static_folder, "index.html")


@socketio.on("connect")
def on_connect():
    """Handle new client connection"""
    sid = request.sid
    logger.info(f"Client connected: {sid}")
    emit("connected", {"sid": sid})


@socketio.on("join")
def on_join(data=None):
    """
    Handle user requesting to join/match with another user.
    Uses Redis pipeline for atomic operations to prevent race conditions.
    """
    sid = request.sid
    
    try:
        # Try to pop a waiting user
        partner = pop_waiting()
        
        if partner is None or partner == sid:
            # No partner available, add to waiting queue
            push_waiting(sid)
            emit("status", {"msg": "waiting"}, to=sid)
            logger.info(f"{sid} is waiting for a match")
        else:
            # Found a partner, create room
            room = f"room-{min(partner, sid)}-{max(partner, sid)}"
            
            # Join both users to room
            join_room(room, sid=sid)
            join_room(room, sid=partner)
            
            # Store mappings
            set_partner(sid, partner)
            set_room(sid, room)
            set_room(partner, room)
            
            # Notify both users
            emit("matched", {"peer": partner, "room": room}, to=sid)
            emit("matched", {"peer": sid, "room": room}, to=partner)
            
            logger.info(f"Matched {sid} with {partner} in {room}")
            
    except Exception as e:
        logger.error(f"Error in on_join for {sid}: {e}")
        emit("error", {"msg": "Failed to join"}, to=sid)


@socketio.on("signal")
def on_signal(payload):
    """
    Forward WebRTC signaling data between peers.
    Payload format: { "to": "<sid>", "data": {...} }
    """
    sid = request.sid
    
    try:
        to = payload.get("to")
        data = payload.get("data")
        
        if not to or not data:
            logger.warning(f"Invalid signal payload from {sid}")
            return
        
        # Verify the recipient is the actual partner
        partner = get_partner(sid)
        if partner != to:
            logger.warning(f"{sid} tried to signal non-partner {to}")
            return
        
        # Forward signal to partner
        emit("signal", {"from": sid, "data": data}, to=to)
        logger.debug(f"Forwarded signal from {sid} to {to}")
        
    except Exception as e:
        logger.error(f"Error in on_signal for {sid}: {e}")


@socketio.on("chat_message")
def on_chat_message(payload):
    """
    Forward chat messages between matched partners.
    Payload format: { "message": "<text>" }
    """
    sid = request.sid
    
    try:
        message = payload.get("message", "").strip()
        
        if not message:
            logger.warning(f"Empty chat message from {sid}")
            return
        
        # Get partner
        partner = get_partner(sid)
        
        if not partner:
            logger.warning(f"{sid} tried to send message without partner")
            emit("error", {"msg": "No partner connected"}, to=sid)
            return
        
        # Forward message to partner
        emit("chat_message", {"message": message}, to=partner)
        logger.info(f"Chat message from {sid} to {partner}: {message[:50]}")
        
    except Exception as e:
        logger.error(f"Error in on_chat_message for {sid}: {e}")


@socketio.on("leave")
def on_leave(data=None):
    """Handle user explicitly leaving a match"""
    sid = request.sid
    
    try:
        # Get partner before clearing
        partner = get_partner(sid)
        room = get_room(sid)
        
        if room:
            leave_room(room, sid=sid)
            logger.info(f"{sid} left room {room}")
        
        # Clear mappings
        clear_partner(sid)
        clear_room(sid)
        
        # Notify partner
        if partner:
            emit("partner_left", {"peer": sid}, to=partner)
            # Also clear partner's mappings
            clear_room(partner)
            if room:
                leave_room(room, sid=partner)
        
        # Send confirmation
        emit("left", {"msg": "You left the conversation"}, to=sid)
        
    except Exception as e:
        logger.error(f"Error in on_leave for {sid}: {e}")


@socketio.on("disconnect")
def on_disconnect():
    """Handle client disconnection"""
    sid = request.sid
    
    try:
        # Remove from waiting queue
        remove_waiting(sid)
        
        # Get partner and room before clearing
        partner = get_partner(sid)
        room = get_room(sid)
        
        # Clear mappings
        clear_partner(sid)
        clear_room(sid)
        
        # Notify partner if exists
        if partner:
            emit("partner_disconnected", {"peer": sid}, to=partner)
            # Clear partner's mappings too
            clear_room(partner)
            if room:
                leave_room(room, sid=partner)
            logger.info(f"{sid} disconnected, notified partner {partner}")
        
        logger.info(f"Client disconnected: {sid}")
        
    except Exception as e:
        logger.error(f"Error in on_disconnect for {sid}: {e}")


@socketio.on_error_default
def default_error_handler(e):
    """Handle any uncaught errors"""
    logger.error(f"SocketIO error: {e}")
    emit("error", {"msg": "An error occurred"})


# ============================================================================
# Application Entry Point
# ============================================================================

if __name__ == "__main__":
    logger.info(f"Starting server on port {PORT}")
    logger.info(f"Redis URL: {REDIS_URL}")
    socketio.run(app, host="127.0.0.1", port=5500, debug=False)