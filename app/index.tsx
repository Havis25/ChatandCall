import { Link } from "expo-router";
import { View, Button } from "react-native";
export default function Home() {
  return (
    <View style={{ flex: 1, gap: 12, padding: 20, justifyContent: "center" }}>
      <Link href="/chat" asChild>
        <Button title="Go to Chat" />
      </Link>
      <Link href="/mock-call" asChild>
        <Button title="Go to Mock Call" />
      </Link>
    </View>
  );
}
