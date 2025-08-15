import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import { View, Text, TextInput, Button, Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Chat, MessageType } from "@flyerhq/react-native-chat-ui";
import { getSocket, SOCKET_URL } from "@/src/realtime/socket";
import { useAuth } from "@/src/store/useAuth";
import { Colors } from "@/src/theme/color";

type Peer = { sid: string; userId: string };
const MAX_MSG = 200;

export default function ChatScreen() {
  // === IDENTITAS USER ===
  const uid = useAuth((s) => s.uid);
  const user = useMemo(() => ({ id: uid, firstName: "You" }), [uid]);

  // === STATE CHAT ===
  const [messages, setMessages] = useState<MessageType.Any[]>([]);
  const [connected, setConnected] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [connErr, setConnErr] = useState<string>("");

  const [socketId, setSocketId] = useState<string>("");
  const [partnerId, setPartnerId] = useState("");
  const [dmRoom, setDmRoom] = useState<string | null>(null);
  const [dmPeers, setDmPeers] = useState<Peer[]>([]);
  const storageKey = dmRoom ? `msgs:${dmRoom}` : "msgs:__no_dm__";

  const dmRoomRef = useRef<string | null>(null);
  useEffect(() => {
    dmRoomRef.current = dmRoom;
  }, [dmRoom]);

  // ===== SOCKET lifecycle =====
  useEffect(() => {
    const s = getSocket();

    const onConnect = () => {
      setConnected(true);
      setSocketId(s.id ?? "");
      setConnErr("");
      s.emit("auth:register", { userId: uid });
      if (dmRoomRef.current) {
        s.emit("dm:join", { room: dmRoomRef.current });
        s.emit("presence:get", { room: dmRoomRef.current });
      }
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

    s.emit("auth:register", { userId: uid });
    if (s.connected) onConnect();

    return () => {
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("connect_error", onConnectError);
      s.off("auth:ok", onAuthOk);
    };
  }, [uid]);

  // ===== LOAD PESAN LOKAL SAAT ROOM BERGANTI (+ de-dupe) =====
  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(storageKey);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as MessageType.Any[];
          // de-dupe by id
          const uniq = Array.from(
            new Map(parsed.map((m) => [m.id, m])).values()
          );
          setMessages(uniq);
        } catch {
          setMessages([]);
        }
      } else {
        setMessages([]);
      }
    })();
  }, [storageKey]);

  // ===== HANDLER DM & CHAT =====
  useEffect(() => {
    const s = getSocket();

    const onDMPending = ({ room }: { room: string }) => {
      if (dmRoomRef.current && dmRoomRef.current !== room) {
        s.emit("leave", { room: dmRoomRef.current });
      }
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
      if (dmRoomRef.current && dmRoomRef.current !== room) {
        s.emit("leave", { room: dmRoomRef.current });
      }
      setDmRoom(room);
      s.emit("dm:join", { room });
      s.emit("presence:get", { room });
      Alert.alert("Incoming DM", `Terhubung dengan ${fromUserId}`);
    };

    const onDMReady = ({ room }: { room: string }) => {
      s.emit("presence:get", { room });
    };

    const onPresence = (payload: { room: string; peers: Peer[] }) => {
      if (!dmRoomRef.current || payload.room !== dmRoomRef.current) return;
      setDmPeers(payload.peers);
    };

    // *** DEDUPE di onNew untuk mengantisipasi echo (safety) ***
    const onNew = (msg: any) => {
      if (!dmRoomRef.current || msg?.room !== dmRoomRef.current) return;
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
        let next: MessageType.Any[];
        if (idx !== -1) {
          next = prev.slice();
          next[idx] = { ...prev[idx], ...incoming };
        } else {
          next = [incoming, ...prev].slice(0, MAX_MSG);
        }
        AsyncStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      });
    };

    s.on("dm:pending", onDMPending);
    s.on("dm:request", onDMRequest);
    s.on("dm:ready", onDMReady);
    s.on("presence:list", onPresence);
    s.on("chat:new", onNew);

    return () => {
      s.off("dm:pending", onDMPending);
      s.off("dm:request", onDMRequest);
      s.off("dm:ready", onDMReady);
      s.off("presence:list", onPresence);
      s.off("chat:new", onNew);
    };
  }, [storageKey]);

  // ===== AKSI: OPEN DM =====
  const openDM = useCallback(() => {
    const id = partnerId.trim();
    if (!id) return Alert.alert("Partner ID kosong");
    if (id === uid) return Alert.alert("Tidak bisa DM diri sendiri");
    if (!connected)
      return Alert.alert(
        "Belum tersambung ke server",
        connErr || "Periksa URL server & jaringan."
      );
    if (!authed) {
      Alert.alert(
        "Belum terdaftar",
        "Mengirim registrasi ulang… coba tekan Connect lagi."
      );
      const s = getSocket();
      s.emit("auth:register", { userId: uid });
      return;
    }
    getSocket().emit("dm:open", { toUserId: id });
  }, [partnerId, uid, connected, authed, connErr]);

  // ===== KIRIM PESAN =====
  const handleSend = useCallback(
    ({ text }: { text: string }) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!dmRoom) {
        Alert.alert("Belum terhubung", "Masukkan Partner ID lalu Connect");
        return;
      }
      const now = Date.now();
      const outgoing: MessageType.Text = {
        id: `m_${now}`,
        author: user,
        createdAt: now,
        text: trimmed,
        type: "text",
      };

      // optimistic + persist
      setMessages((prev) => {
        const next = [outgoing, ...prev].slice(0, MAX_MSG);
        AsyncStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      });

      getSocket().emit("chat:send", { ...outgoing, room: dmRoom });
    },
    [user, dmRoom, storageKey]
  );

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 12, gap: 6, backgroundColor: "#f8fafc" }}>
        <Text style={{ fontWeight: "bold" }}>Your ID: {uid}</Text>
        <Text>Server: {SOCKET_URL}</Text>
        <Text>Socket ID: {socketId || "—"}</Text>
        <Text>
          Status:{" "}
          {connected
            ? authed
              ? "Connected + Authed"
              : "Connected (auth pending)"
            : "Disconnected"}
        </Text>
        {connErr ? (
          <Text style={{ color: "#b91c1c" }}>Error: {connErr}</Text>
        ) : null}

        <View
          style={{
            flexDirection: "row",
            gap: 8,
            alignItems: "center",
            marginTop: 6,
          }}
        >
          <TextInput
            placeholder="Partner ID"
            value={partnerId}
            onChangeText={setPartnerId}
            autoCapitalize="none"
            style={{
              flex: 1,
              backgroundColor: "#fff",
              borderWidth: 1,
              borderColor: "#e5e7eb",
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
          />
          <Button title="Connect" onPress={openDM} />
        </View>

        <Text style={{ marginTop: 4 }}>
          Active Room: {dmRoom ?? "–"} • Peers: {dmPeers.length}
        </Text>
      </View>

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
  );
}
