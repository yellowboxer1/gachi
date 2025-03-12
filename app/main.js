import React, { useState, useEffect } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { StatusBar, View, Platform, useColorScheme, StyleSheet } from 'react-native';
import MapView from './_components/MapView';
import SpeechModal from './_components/SpeechModal';
import useSpeechRecognition from './_hooks/useSpeechRecognition';
import { initializeLocation } from '../utils/locationUtils';
import { getTransitDirections } from '../services/tmapService';
import * as Speech from 'expo-speech';

export default function Main() {
    const colorScheme = useColorScheme();
    const [userLocation, setUserLocation] = useState(null);
    const [destination, setDestination] = useState(null);
    const [route, setRoute] = useState({ walk: [], subway: [], bus: [] });
    const [instructions, setInstructions] = useState([]);
    const [isSpeechModalVisible, setIsSpeechModalVisible] = useState(false);

    useEffect(() => {
        console.log('Main: userLocation=', userLocation);
        initializeLocation(setUserLocation);
        Speech.speak('화면을 길게 누르면 음성 인식 모드로 전환됩니다.', { language: 'ko-KR' });
    }, []);

    const startNavigation = async (dest) => {
        try {
            const effectiveDestination = dest || destination;
            console.log('Starting navigation with:', { userLocation, effectiveDestination });

            if (!userLocation || !effectiveDestination) {
                Speech.speak('위치 또는 목적지가 설정되지 않았습니다.', { language: 'ko-KR' });
                console.error('위치 또는 목적지가 설정되지 않았습니다.');
                return;
            }
            if (!isValidLatLng(userLocation) || !isValidLatLng(effectiveDestination)) {
                Speech.speak('유효하지 않은 위치 또는 목적지입니다.', { language: 'ko-KR' });
                console.error('유효하지 않은 위치 또는 목적지입니다.', { userLocation, effectiveDestination });
                return;
            }
            Speech.speak('대중교통 내비게이션을 시작합니다.', { language: 'ko-KR' });
            const { formattedRoute, navigationInstructions } = await getTransitDirections(userLocation, effectiveDestination);
            if (!Array.isArray(formattedRoute) || formattedRoute.length < 2) {
                throw new Error('유효한 경로가 없습니다.');
            }
            const walkRoute = [];
            const subwayRoute = [];
            const busRoute = [];
            let currentIndex = 0;

            navigationInstructions.forEach((instr) => {
                const segmentLength = instr.position
                    ? formattedRoute.findIndex(coord => 
                        coord.latitude === instr.position.latitude && coord.longitude === instr.position.longitude
                      ) - currentIndex
                    : formattedRoute.length - currentIndex;
                const segment = formattedRoute.slice(currentIndex, currentIndex + segmentLength);

                if (instr.type === 'crosswalk' || instr.description.includes('이동')) {
                    walkRoute.push(...segment);
                } else if (instr.type === 'subway') {
                    subwayRoute.push(...segment);
                } else if (instr.type === 'bus') {
                    busRoute.push(...segment);
                }
                currentIndex += segmentLength;
            });

            if (currentIndex < formattedRoute.length) {
                walkRoute.push(...formattedRoute.slice(currentIndex));
            }

            setRoute({ walk: walkRoute, subway: subwayRoute, bus: busRoute });
            setInstructions(navigationInstructions || []);

            navigationInstructions.forEach((instr, index) => {
                setTimeout(() => {
                    Speech.speak(instr.description, { language: 'ko-KR' });
                }, index * 5000);
            });
        } catch (error) {
            console.error('Navigation error:', error);
            Speech.speak('내비게이션을 시작하는 데 문제가 발생했습니다.', { language: 'ko-KR' });
            setRoute({ walk: [], subway: [], bus: [] });
            setInstructions([{ type: 'manual', description: '현재 위치에서 출발하세요.', position: userLocation || {} }]);
        }
    };

    const speechOptions = {
        setRoute,
        setDestination,
        setIsSpeechModalVisible,
        userLocation,
        startNavigation,
    };
    const { startListening, stopListening } = useSpeechRecognition(speechOptions || {});

    return (
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <View style={styles.container}>
                <MapView
                    userLocation={userLocation}
                    destination={destination}
                    route={route}
                    setRoute={setRoute}
                    setIsSpeechModalVisible={setIsSpeechModalVisible}
                    startListening={startListening}
                    stopListening={stopListening}
                    startNavigation={startNavigation}
                />
                {isSpeechModalVisible && <SpeechModal isVisible={isSpeechModalVisible} />}
            </View>
            <StatusBar
                barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'}
                backgroundColor={Platform.OS === 'android' ? (colorScheme === 'dark' ? 'black' : 'white') : 'transparent'}
                translucent={Platform.OS === 'ios'}
            />
        </ThemeProvider>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
});

function isValidLatLng(location) {
    return (
        location &&
        typeof location.latitude === 'number' &&
        typeof location.longitude === 'number' &&
        !isNaN(location.latitude) &&
        !isNaN(location.longitude) &&
        location.latitude >= -90 &&
        location.latitude <= 90 &&
        location.longitude >= -180 &&
        location.longitude <= 180
    );
}