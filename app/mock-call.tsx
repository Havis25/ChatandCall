import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { View, Text, Button, Image, TextInput, Alert } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { getSocket, SOCKET_URL } from "@/src/realtime/socket";
import { useAuth } from "@/src/store/useAuth";
import { useLocalSearchParams } from "expo-router";

type CallStatus = "idle" | "ringing" | "in-call";
type Peer = { sid: string; userId: string };

const FPS = 1.5; // ~1–2 fps

export default function MockCall() {
  const { room } = useLocalSearchParams<{ room?: string }>();
  const urlRoom = typeof room === "string" && room.trim() ? room : "general";
  const fallbackCallRoom = `call:${urlRoom}`;

  const uid = useAuth((s) => s.uid);
  const socket = getSocket();

  const [permission, requestPermission] = useCameraPermissions();
  const camRef = useRef<React.ElementRef<typeof CameraView> | null>(null);
  const frameTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [facing, setFacing] = useState<"front" | "back">("front");
  const [status, setStatus] = useState<CallStatus>("idle");
  const [remoteFrame, setRemoteFrame] = useState<string | null>(null);
  const [peerCount, setPeerCount] = useState(1);
  const [socketId, setSocketId] = useState<string>("");

  // Pairing by ID
  const [partnerId, setPartnerId] = useState("");
  const [dmRoom, setDmRoom] = useState<string | null>(null);
  const ACTIVE_ROOM = useMemo(
    () => dmRoom ?? fallbackCallRoom,
    [dmRoom, fallbackCallRoom]
  );

  // Register & show socket id
  useEffect(() => {
    const s = socket;
    const onConnect = () => {
      setSocketId(s.id ?? ""); // <= FIX di sini
      s.emit("auth:register", { userId: uid });
    };
    s.on("connect", onConnect);
    if (s.connected) onConnect();
    return () => {
      s.off("connect", onConnect);
    };
  }, [socket, uid]);

  useEffect(() => {
    if (permission && !permission.granted) requestPermission();
  }, [permission, requestPermission]);

  // DM handlers
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
    const onDMReady = ({ room }: { room: string }) => {
      s.emit("presence:get", { room });
    };

    s.on("dm:pending", onDMPending);
    s.on("dm:request", onDMRequest);
    s.on("dm:ready", onDMReady);

    return () => {
      s.off("dm:pending", onDMPending);
      s.off("dm:request", onDMRequest);
      s.off("dm:ready", onDMReady);
    };
  }, [socket]);

  const connectPartner = useCallback(() => {
    const id = partnerId.trim();
    if (!id) return Alert.alert("Partner ID kosong");
    if (id === uid) return Alert.alert("Tidak bisa connect ke diri sendiri");
    socket.emit("dm:open", { toUserId: id });
  }, [partnerId, socket, uid]);

  // Join/leave ACTIVE_ROOM + call events
  useEffect(() => {
    const s = socket;

    const onPresence = (payload: { room: string; peers: Peer[] }) => {
      if (payload.room !== ACTIVE_ROOM) return;
      setPeerCount(payload.peers.length);
    };
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

    s.emit("join", { room: ACTIVE_ROOM, userId: uid });
    s.emit("presence:get", { room: ACTIVE_ROOM });

    s.on("presence:list", onPresence);
    s.on("call:ringing", onRinging);
    s.on("call:accepted", onAccepted);
    s.on("call:ended", onEnded);
    s.on("call:frame", onFrame);

    return () => {
      s.off("presence:list", onPresence);
      s.off("call:ringing", onRinging);
      s.off("call:accepted", onAccepted);
      s.off("call:ended", onEnded);
      s.off("call:frame", onFrame);
      s.emit("leave", { room: ACTIVE_ROOM, userId: uid });
      stopStreaming();
    };
  }, [socket, uid, ACTIVE_ROOM]);

  // streaming
  const startStreaming = useCallback(() => {
    if (frameTimer.current) return;
    frameTimer.current = setInterval(async () => {
      try {
        const cam: any = camRef.current;
        if (!cam?.takePictureAsync) return;
        const photo = await cam.takePictureAsync({
          quality: 0.15,
          base64: true,
          skipProcessing: true,
        });
        if (photo?.base64)
          socket.emit("call:frame", { room: ACTIVE_ROOM, data: photo.base64 });
      } catch {}
    }, 1000 / FPS);
  }, [ACTIVE_ROOM, socket]);

  const stopStreaming = useCallback(() => {
    if (frameTimer.current) clearInterval(frameTimer.current);
    frameTimer.current = null;
  }, []);

  const placeCall = () => {
    if (peerCount < 2) {
      Alert.alert(
        "Belum ada peer",
        "Partner belum ada di room yang sama. Connect ID di kedua device atau buka URL room yang sama."
      );
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

  if (!permission) return <Text>Mengecek izin kamera…</Text>;
  if (!permission.granted) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
        }}
      >
        <Text style={{ marginBottom: 12 }}>
          Aplikasi membutuhkan izin kamera.
        </Text>
        <Button title="Izinkan Kamera" onPress={requestPermission} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 12, gap: 8 }}>
      <Text style={{ fontWeight: "bold" }}>Your ID: {uid}</Text>
      <Text>Server: {SOCKET_URL}</Text>
      <Text>Socket ID: {socketId}</Text>

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
        <Button title="Connect" onPress={connectPartner} />
      </View>

      <Text style={{ marginTop: 4 }}>
        Active Room: {ACTIVE_ROOM} • Peers: {peerCount}
      </Text>

      <CameraView
        ref={(r: React.ElementRef<typeof CameraView> | null) => {
          camRef.current = r;
        }}
        style={{ flex: 1, borderRadius: 12, marginTop: 6 }}
        facing={facing}
      />

      <View
        style={{
          flex: 1,
          borderRadius: 12,
          overflow: "hidden",
          backgroundColor: "#111",
          marginTop: 6,
        }}
      >
        {remoteFrame ? (
          <Image
            source={{ uri: `data:image/jpeg;base64,${remoteFrame}` }}
            style={{ width: "100%", height: "100%" }}
            resizeMode="cover"
          />
        ) : (
          <View
            style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: "#fff" }}>
              {status === "in-call"
                ? "Menunggu frame dari peer…"
                : "Belum ada panggilan"}
            </Text>
          </View>
        )}
      </View>

      <View
        style={{
          flexDirection: "row",
          gap: 8,
          flexWrap: "wrap",
          marginVertical: 8,
        }}
      >
        <Button
          title="Switch Camera"
          onPress={() => setFacing((p) => (p === "front" ? "back" : "front"))}
        />
        {status === "idle" && <Button title="Call" onPress={placeCall} />}
        {status === "ringing" && <Button title="Accept" onPress={accept} />}
        {(status === "ringing" || status === "in-call") && (
          <Button title="Hang Up" onPress={hangup} />
        )}
      </View>
    </View>
  );
}
