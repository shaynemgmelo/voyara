import React, { useRef, useState } from 'react';
import {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { colors, typography, spacing } from '../theme';
import { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Onboarding'>;

const slides = [
  {
    emoji: '📍',
    title: 'Pare de planejar.\nComece a viajar.',
    description:
      'Cole o link daquele vídeo de viagem que você salvou. Em 30 segundos você tem um roteiro completo dia a dia.',
  },
  {
    emoji: '🗺️',
    title: 'Roteiros com mapa,\ntiming e ordem perfeita.',
    description:
      'Lugares reais validados pelo Google Maps. Horários de abertura, avaliações, fotos — tudo no seu bolso.',
  },
  {
    emoji: '✨',
    title: 'Assistente pessoal\nde viagem com IA.',
    description:
      'Descubra lugares que você nunca encontraria sozinho. Pergunte, ajuste, compartilhe com quem vai junto.',
  },
];

export function OnboardingScreen() {
  const navigation = useNavigation<Nav>();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList>(null);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const newIndex = Math.round(e.nativeEvent.contentOffset.x / width);
    if (newIndex !== index) setIndex(newIndex);
  };

  const handleNext = () => {
    if (index < slides.length - 1) {
      listRef.current?.scrollToIndex({ index: index + 1, animated: true });
    } else {
      navigation.navigate('Auth');
    }
  };

  return (
    <Screen>
      <FlatList
        ref={listRef}
        data={slides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyExtractor={(item) => item.title}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width }]}>
            <View style={styles.emojiCircle}>
              <Text style={styles.emoji}>{item.emoji}</Text>
            </View>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.description}>{item.description}</Text>
          </View>
        )}
      />

      <View style={styles.dots}>
        {slides.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i === index && styles.dotActive]}
          />
        ))}
      </View>

      <View style={styles.footer}>
        <Button
          label={index < slides.length - 1 ? 'Continuar' : 'Começar'}
          onPress={handleNext}
          size="lg"
          fullWidth
        />
        <Button
          label="Pular"
          onPress={() => navigation.navigate('Auth')}
          variant="ghost"
          size="md"
          fullWidth
          style={{ marginTop: spacing.md }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  emojiCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.huge,
  },
  emoji: {
    fontSize: 72,
  },
  title: {
    ...typography.displayMedium,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  description: {
    ...typography.bodyLarge,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 320,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: spacing.xxl,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
    marginHorizontal: 4,
  },
  dotActive: {
    backgroundColor: colors.primary,
    width: 24,
  },
  footer: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xl,
  },
});
