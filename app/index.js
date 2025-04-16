import React, { useState, useEffect } from 'react';
import { View, TouchableOpacity, Image, Dimensions, Text, StatusBar, Platform, StyleSheet } from 'react-native';
import * as Speech from 'expo-speech';
import { useFonts } from 'expo-font';
import { useRouter } from 'expo-router';

// 원본 코드와 동일한 비율 계산 방식
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ASPECT_RATIO = 375 / 812;
const IMAGE_WIDTH = SCREEN_WIDTH;
const IMAGE_HEIGHT = SCREEN_WIDTH / ASPECT_RATIO;

export default function Splash() {
    const [fontsLoaded, fontError] = useFonts({
        SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    });
    const [appState, setAppState] = useState('splash');
    const router = useRouter();

    useEffect(() => {
        if (fontsLoaded && !fontError) {
            const timer = setTimeout(() => {
                setAppState('notice');
                Speech.speak('주의, 이 앱은 보이스 오버 또는 토크백의 사용을 권장합니다. 시작하려면 화면을 눌러주세요.', {
                    language: 'ko-KR',
                    onError: (error) => console.error('Speech error:', error),
                });
            }, 3000);
            return () => clearTimeout(timer);
        } else if (fontError) {
            console.error('Font loading error:', fontError);
        }
    }, [fontsLoaded, fontError]);

    const handlePress = () => {
        router.replace('/main');
    };

    if (!fontsLoaded && !fontError) {
        return (
            <View style={styles.splashContainer}>
                <StatusBar
                    backgroundColor="black"
                    barStyle="light-content"
                    translucent={Platform.OS === 'ios'}
                />
            </View>
        );
    }

    return (
        <View style={appState === 'splash' ? styles.splashContainer : styles.noticeContainer}>
            <StatusBar
                backgroundColor="black"
                barStyle="light-content"
                translucent={Platform.OS === 'ios'}
            />
            {appState === 'splash' ? (
                <Image
                    source={require('../assets/images/splash.png')}
                    style={{ width: IMAGE_WIDTH, height: IMAGE_HEIGHT, resizeMode: 'contain' }}
                />
            ) : (
                <TouchableOpacity
                    style={styles.noticeContainer}
                    onPress={handlePress}
                    accessible={true}
                    accessibilityLabel="주의, 이 앱은 보이스 오버 또는 토크백의 사용을 권장합니다. 시작하려면 화면을 눌러주세요."
                >
                    <View style={styles.imageWrapper}>
                        <Image
                            source={require('../assets/images/warning.png')}
                            style={{ width: IMAGE_WIDTH, height: IMAGE_HEIGHT, resizeMode: 'contain' }}
                        />
                    </View>
                </TouchableOpacity>
            )}
        </View>
    );
}

const styles = {
    splashContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
    },
    noticeContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#F5FCFF',
        width: '100%',
        height: '100%',
    },
    imageWrapper: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    }
};