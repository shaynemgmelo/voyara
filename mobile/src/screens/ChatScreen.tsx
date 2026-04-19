import React, { useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  RouteProp,
  useRoute,
} from '@react-navigation/native';
import { Screen } from '../components/Screen';
import { colors, typography, spacing, radius } from '../theme';
import { api } from '../api/client';
import { RootStackParamList } from '../navigation/types';

type Rt = RouteProp<RootStackParamList, 'Chat'>;

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

export function ChatScreen() {
  const { params } = useRoute<Rt>();
  const listRef = useRef<FlatList>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Oi! Posso ajudar a ajustar seu roteiro, sugerir lugares, mudar a ordem. O que você quer?',
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!input.trim() || sending) return;
    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: input.trim(),
    };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setSending(true);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);

    try {
      const res = await api.ai.post<{ reply: string }>('/chat', {
        trip_id: params.tripId,
        message: userMsg.text,
        history: messages.slice(-10).map((m) => ({ role: m.role, content: m.text })),
      });
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: res.reply ?? 'Hmm, não consegui responder agora.',
        },
      ]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: 'Erro: ' + (e?.message ?? 'tente novamente'),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View
              style={[
                styles.bubble,
                item.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
              ]}
            >
              <Text
                style={[
                  typography.body,
                  { color: item.role === 'user' ? colors.text : colors.text },
                ]}
              >
                {item.text}
              </Text>
            </View>
          )}
        />

        <View style={styles.inputBar}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Pergunte algo sobre o roteiro..."
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            multiline
          />
          <Pressable
            onPress={send}
            disabled={!input.trim() || sending}
            style={[
              styles.sendBtn,
              (!input.trim() || sending) && { opacity: 0.4 },
            ]}
          >
            <Text style={styles.sendText}>{sending ? '...' : '↑'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  bubble: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.xl,
    marginBottom: spacing.sm,
    maxWidth: '85%',
  },
  bubbleUser: {
    backgroundColor: colors.primary,
    alignSelf: 'flex-end',
  },
  bubbleAssistant: {
    backgroundColor: colors.bgCard,
    alignSelf: 'flex-start',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  input: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgInput,
    borderRadius: radius.lg,
  },
  sendBtn: {
    marginLeft: spacing.sm,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: {
    ...typography.h3,
    color: colors.text,
  },
});
