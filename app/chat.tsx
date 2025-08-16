// app/chat.tsx
import { Chat, MessageType } from "@flyerhq/react-native-chat-ui";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useLocalSearchParams } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Button,
  Image,
  Platform,
  Text,
  View,
} from "react-native";

import { useAuth } from "@/hooks/useAuth";
import { getSocket, SOCKET_URL } from "@/src/realtime/socket";
import { Colors } from "@/src/theme/color";

type Peer = { sid: string; userId: string };
type CallStatus = "idle" | "ringing" | "in-call";

const MAX_MSG = 200;
const FPS = 1.5;

export default function ChatAndCallScreen() {
  const { room } = useLocalSearchParams<{ room?: string }>();
  const urlRoom = typeof room === "string" && room.trim() ? room : "general";
  const fallbackCallRoom = `call:${urlRoom}`;

  const { uid, isAuthenticated, hydrated, logout } = useAuth();
  const user = useMemo(() => ({ id: uid, firstName: "You" }), [uid]);
  


  const socket = getSocket();

  // Camera (selalu panggil hooks)
  const [permission, requestPermission] = useCameraPermissions();
  const camRef = useRef<React.ElementRef<typeof CameraView> | null>(null);
  const frameTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Chat state
  const [messages, setMessages] = useState<MessageType.Any[]>([]);
  const [connected, setConnected] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [connErr, setConnErr] = useState<string>("");
  const [socketId, setSocketId] = useState<string>("");

  // DM / pairing
  const [dmRoom, setDmRoom] = useState<string | null>(null);
  const dmRoomRef = useRef<string | null>(null);
  useEffect(() => {
    dmRoomRef.current = dmRoom;
  }, [dmRoom]);

  // Room aktif untuk call & fallback chat
  const ACTIVE_ROOM = useMemo(
    () => dmRoom ?? fallbackCallRoom,
    [dmRoom, fallbackCallRoom]
  );
  const storageKey = `msgs:${ACTIVE_ROOM}`;

  // Presence & call
  const [activePeers, setActivePeers] = useState<Peer[]>([]);
  const [peerCount, setPeerCount] = useState(1);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [remoteFrame, setRemoteFrame] = useState<string | null>(null);
  const [facing] = useState<"front" | "back">("front");

  // ===== socket connect + auth (selalu deklarasi hook, tapi gate di dalam) =====
  useEffect(() => {
    const s = socket;
    const onConnect = () => {
      setConnected(true);
      setSocketId(s.id ?? "");
      setConnErr("");
      if (!hydrated || !isAuthenticated || !uid) return;
      s.emit("auth:register", { userId: uid });
      s.emit("join", { room: ACTIVE_ROOM, userId: uid });
      s.emit("presence:get", { room: ACTIVE_ROOM });
    };
    const onDisconnect = () => {
      setConnected(false);
      setAuthed(false);
    };
    const onConnectError = (err: any) =>
      setConnErr(String(err?.message || "connect_error"));
    const onAuthOk = () => setAuthed(true);

    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("connect_error", onConnectError);
    s.on("auth:ok", onAuthOk);

    if (s.connected) onConnect();
    return () => {
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("connect_error", onConnectError);
      s.off("auth:ok", onAuthOk);
    };
  }, [socket, uid, ACTIVE_ROOM, isAuthenticated, hydrated]);

  // ===== load pesan lokal per room =====
  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(storageKey);
      if (!raw) return setMessages([]);
      try {
        const parsed = JSON.parse(raw) as MessageType.Any[];
        const uniq = Array.from(new Map(parsed.map((m) => [m.id, m])).values());
        setMessages(uniq);
      } catch {
        setMessages([]);
      }
    })();
  }, [storageKey]);

  // ===== handlers DM / chat / presence =====
  useEffect(() => {
    const s = socket;

    const onDMPending = ({ room }: { room: string }) => {
      setDmRoom(room);
      s.emit("presence:get", { room });
    };

    const onDMRequest = ({
      room,
      fromUserId,
    }: {
      room: string;
      fromUserId: string;
    }) => {
      setDmRoom(room);
      s.emit("dm:join", { room });
      s.emit("presence:get", { room });
      Alert.alert("Incoming DM", `Terhubung dengan ${fromUserId}`);
    };

    const onDMReady = ({ room }: { room: string }) =>
      s.emit("presence:get", { room });

    const onPresence = (payload: { room: string; peers: Peer[] }) => {
      if (payload.room === ACTIVE_ROOM) {
        setActivePeers(payload.peers);
        setPeerCount(payload.peers.length);
      }
    };

    const onNew = (msg: any) => {
      if (msg?.room !== ACTIVE_ROOM) return;
      if (typeof msg?.text !== "string" || !msg.text.trim()) return;

      const incoming: MessageType.Text = {
        id: String(msg._id ?? msg.id ?? Date.now()),
        author: { id: msg.user?._id ?? msg.author?.id ?? "peer" },
        createdAt: Number(msg.createdAt) || Date.now(),
        text: msg.text,
        type: "text",
      };

      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === incoming.id);
        const next =
          idx !== -1
            ? (() => {
                const cp = prev.slice();
                cp[idx] = { ...prev[idx], ...incoming };
                return cp;
              })()
            : [incoming, ...prev].slice(0, MAX_MSG);
        AsyncStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      });
    };

    s.on("dm:pending", onDMPending);
    s.on("dm:request", onDMRequest);
    s.on("dm:ready", onDMReady);
    s.on("presence:list", onPresence);
    s.on("chat:new", onNew);

    // join room hanya saat sudah punya uid
    if (hydrated && uid) {
      s.emit("join", { room: ACTIVE_ROOM, userId: uid });
      s.emit("presence:get", { room: ACTIVE_ROOM });
    }

    return () => {
      s.off("dm:pending", onDMPending);
      s.off("dm:request", onDMRequest);
      s.off("dm:ready", onDMReady);
      s.off("presence:list", onPresence);
      s.off("chat:new", onNew);
      if (uid) s.emit("leave", { room: ACTIVE_ROOM, userId: uid });
    };
  }, [socket, uid, ACTIVE_ROOM, storageKey, hydrated]);

  // ===== send message (tidak conditional hooks) =====
  const handleSend = useCallback(
    ({ text }: { text: string }) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const now = Date.now();
      const outgoing: MessageType.Text = {
        id: `m_${now}`,
        author: user,
        createdAt: now,
        text: trimmed,
        type: "text",
      };
      setMessages((prev) => {
        const next = [outgoing, ...prev].slice(0, MAX_MSG);
        AsyncStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      });
      socket.emit("chat:send", { ...outgoing, room: ACTIVE_ROOM });
    },
    [user, ACTIVE_ROOM, storageKey, socket]
  );

  // ===== quick DM (logic biasa) =====
  const quickDM = useCallback(() => {
    const target = activePeers.find((p) => p.userId && p.userId !== uid);
    if (!target) {
      Alert.alert("Tidak ada peer", "Pastikan 2 device ada di room yang sama.");
      return;
    }
    socket.emit("dm:open", { toUserId: target.userId });
  }, [activePeers, uid, socket]);

  // ===== mock call =====
  const startStreaming = useCallback(async () => {
    if (frameTimer.current) return;
    if (!permission?.granted) {
      const r = await requestPermission();
      if (!r.granted) return Alert.alert("Izin kamera ditolak");
    }
    frameTimer.current = setInterval(async () => {
      try {
        const cam: any = camRef.current;
        if (!cam?.takePictureAsync) return;
        const photo = await cam.takePictureAsync({
          quality: Platform.OS === "ios" ? 0.2 : 0.15,
          base64: true,
          skipProcessing: true,
        });
        if (photo?.base64)
          socket.emit("call:frame", { room: ACTIVE_ROOM, data: photo.base64 });
      } catch {}
    }, 1000 / FPS);
  }, [permission?.granted, requestPermission, ACTIVE_ROOM, socket]);

  const stopStreaming = useCallback(() => {
    if (frameTimer.current) clearInterval(frameTimer.current);
    frameTimer.current = null;
  }, []);

  useEffect(() => {
    const s = socket;
    const onRinging = () => setStatus("ringing");
    const onAccepted = () => {
      setStatus("in-call");
      startStreaming();
    };
    const onEnded = () => {
      stopStreaming();
      setStatus("idle");
      setRemoteFrame(null);
    };
    const onFrame = ({ data }: { data: string }) => setRemoteFrame(data);

    s.on("call:ringing", onRinging);
    s.on("call:accepted", onAccepted);
    s.on("call:ended", onEnded);
    s.on("call:frame", onFrame);

    return () => {
      s.off("call:ringing", onRinging);
      s.off("call:accepted", onAccepted);
      s.off("call:ended", onEnded);
      s.off("call:frame", onFrame);
      stopStreaming();
    };
  }, [socket, startStreaming, stopStreaming]);

  const placeCall = () => {
    if (peerCount < 2) {
      Alert.alert("Belum ada peer", "Buka room yang sama di device lain.");
      return;
    }
    socket.emit("call:invite", { room: ACTIVE_ROOM });
    setStatus("ringing");
  };
  const accept = () => {
    socket.emit("call:accept", { room: ACTIVE_ROOM });
    setStatus("in-call");
    startStreaming();
  };
  const hangup = () => {
    socket.emit("call:hangup", { room: ACTIVE_ROOM });
    stopStreaming();
    setStatus("idle");
    setRemoteFrame(null);
  };

  // ==== UI ====
  if (!hydrated) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Memuat sesi…</Text>
      </View>
    );
  }
  if (!isAuthenticated || !uid) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
        }}
      >
        <Text style={{ fontWeight: "bold", fontSize: 16 }}>Belum login</Text>
        <Text style={{ marginTop: 8 }}>Silakan login dulu.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* Header */}
      <View style={{ padding: 12, gap: 6, backgroundColor: "#f8fafc" }}>
        <Text style={{ marginTop: 4 }}>
          Active Room: {ACTIVE_ROOM} • Peers: {peerCount}
        </Text>

        <View
          style={{
            flexDirection: "row",
            gap: 8,
            marginTop: 8,
            flexWrap: "wrap",
          }}
        >
          <Button title="Chat 1:1 (auto)" onPress={quickDM} />
          {status === "idle" && <Button title="Call" onPress={placeCall} />}
          {status === "ringing" && <Button title="Accept" onPress={accept} />}
          {(status === "ringing" || status === "in-call") && (
            <Button title="Hang Up" onPress={hangup} />
          )}
          {status !== "in-call" && !permission?.granted ? (
            <Button title="Enable Camera" onPress={requestPermission} />
          ) : null}
          <Button title="Logout" onPress={logout} color="#dc2626" />
        </View>
      </View>

      {/* Video area */}
      <View
        style={{
          margin: 12,
          marginBottom: 0,
          borderRadius: 12,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: "#e5e7eb",
        }}
      >
        <View style={{ backgroundColor: "#111", height: 240 }}>
          {remoteFrame ? (
            <Image
              source={{ uri: `data:image/jpeg;base64,${remoteFrame}` }}
              style={{ width: "100%", height: "100%" }}
            />
          ) : (
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: "#fff" }}>
                {status === "in-call"
                  ? "Menunggu frame dari peer…"
                  : "Belum ada panggilan"}
              </Text>
            </View>
          )}
          {status === "in-call" && permission?.granted ? (
            <View
              style={{
                position: "absolute",
                right: 10,
                top: 10,
                width: 110,
                height: 160,
                borderRadius: 10,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: "#00000055",
              }}
            >
              <CameraView
                ref={(r: React.ElementRef<typeof CameraView> | null) => {
                  camRef.current = r;
                }}
                facing={facing}
                style={{ width: "100%", height: "100%" }}
              />
            </View>
          ) : null}
        </View>
      </View>

      {/* Chat */}
      <View style={{ flex: 1 }}>
        <Chat
          messages={messages}
          onSendPress={handleSend}
          user={user}
          theme={{
            colors: {
              inputBackground: "#fff",
              background: Colors.bg,
              primary: Colors.primary,
              error: "#ef4444",
              inputText: Colors.text,
              secondary: "#6b7280",
              receivedMessageDocumentIcon: "#6b7280",
              sentMessageDocumentIcon: "#fff",
              userAvatarNameColors: ["#9ca3af"],
              userAvatarImageBackground: Colors.avatarBg,
            },
            borders: { inputBorderRadius: 8, messageBorderRadius: 12 },
            insets: { messageInsetsHorizontal: 16, messageInsetsVertical: 8 },
            fonts: {
              dateDividerTextStyle: {},
              emptyChatPlaceholderTextStyle: {},
              inputTextStyle: {},
              receivedMessageBodyTextStyle: {},
              receivedMessageCaptionTextStyle: {},
              receivedMessageLinkDescriptionTextStyle: {},
              receivedMessageLinkTitleTextStyle: {},
              sentMessageBodyTextStyle: {},
              sentMessageCaptionTextStyle: {},
              sentMessageLinkDescriptionTextStyle: {},
              sentMessageLinkTitleTextStyle: {},
              userAvatarTextStyle: {},
              userNameTextStyle: {},
            },
          }}
        />
      </View>
    </View>
  );
}
