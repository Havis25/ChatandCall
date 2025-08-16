// app/index.tsx
import { useAuth } from "@/hooks/useAuth";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Button,
  Text,
  TextInput,
  View,
} from "react-native";

export default function LoginScreen() {
  const { login, isLoading, isAuthenticated, hydrated } = useAuth();
  const [identifier, setIdentifier] = useState(""); // email/username
  const [password, setPassword] = useState("");

  // Check if already logged in on app start
  useEffect(() => {
    if (hydrated && isAuthenticated) {
      router.replace("/chat");
    }
  }, [hydrated, isAuthenticated]);

  const onLogin = async () => {
    if (!identifier.trim() || !password.trim()) {
      Alert.alert("Error", "Email/Username dan password harus diisi");
      return;
    }
    await login(identifier.trim(), password);
    // tidak perlu navigate di sini; effect di atas yang akan handle
  };

  return (
    <View style={{ flex: 1, padding: 16, justifyContent: "center", gap: 12 }}>
      <Text style={{ fontWeight: "bold", fontSize: 20, marginBottom: 8 }}>
        Login Customer
      </Text>

      <TextInput
        placeholder="Email atau Username"
        autoCapitalize="none"
        keyboardType="email-address"
        value={identifier}
        onChangeText={setIdentifier}
        style={{
          borderWidth: 1,
          borderColor: "#e5e7eb",
          borderRadius: 8,
          padding: 12,
        }}
      />
      <TextInput
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={{
          borderWidth: 1,
          borderColor: "#e5e7eb",
          borderRadius: 8,
          padding: 12,
        }}
      />

      <Button
        title={isLoading ? "Logging in…" : "LOGIN"}
        onPress={onLogin}
        disabled={isLoading}
      />
      {isLoading ? <ActivityIndicator style={{ marginTop: 8 }} /> : null}
    </View>
  );
}
