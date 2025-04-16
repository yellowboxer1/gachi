import { useState } from 'react';
import { Alert } from 'react-native';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { isValidLatLng } from '../../utils/locationUtils';
import { getPoiCoordinates } from '../../services/tmapService';

const useSpeechRecognition = ({ setRoute, setDestination, setIsSpeechModalVisible, userLocation, startNavigation }) => {
    const [recognizedText, setRecognizedText] = useState('');
    const [results, setResults] = useState([]);
    const [partialResults, setPartialResults] = useState([]);
    const [started, setStarted] = useState('');
    const [end, setEnd] = useState('');
    const [error, setError] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [isFinal, setIsFinal] = useState(false);
    const [transcript, setTranscript] = useState('');

    useSpeechRecognitionEvent('start', () => {
        console.log('onSpeechStart');
        setStarted('√');
        setIsFinal(false);
    });
    
    useSpeechRecognitionEvent('end', () => {
        console.log('onSpeechEnd');
        setEnd('√');
        setIsListening(false);
        setIsSpeechModalVisible(false);
    });
    
    useSpeechRecognitionEvent('error', (e) => {
        console.log('onSpeechError: ', e);
        setError(JSON.stringify(e?.error || 'Unknown error'));
        setIsListening(false);
        setIsSpeechModalVisible(false);
        if (e?.error === 'no-speech') {
            Speech.speak('음성이 감지되지 않았습니다. 다시 시도해주세요.', { language: 'ko-KR' });
        }
    });
    
    useSpeechRecognitionEvent('result', (e) => {
        console.log('onSpeechResults: ', e);
        const resultsArray = (e?.results || []).map(result => result?.transcript || '');
        setResults(resultsArray);
        
        if (e?.isFinal && resultsArray.length > 0) {
            const filteredResults = resultsArray
                .map(text => text
                    .replace(/목적지를\s*말씀해\s*주세요/g, '') // 기본 필터링
                    .replace(/시작하려면\s*화면을\s*눌러\s*주세요/g, '') // 추가 필터링
                    .trim()
                )
                .filter(text => text.length > 0);
                
            const destinationName = filteredResults[filteredResults.length - 1] || '';
            
            if (destinationName) {
                setRecognizedText(destinationName);
                setTranscript(destinationName);
                setIsFinal(true);
                console.log('최종 음성 인식 결과:', destinationName);
                // 확인 모드를 위해 여기서 직접 검색하지 않음
                // MapView에서 확인 후 처리하도록 함
            } else {
                console.log('유효한 목적지가 없습니다.');
                Speech.speak('목적지를 인식하지 못했습니다. 다시 말씀해주세요.', { language: 'ko-KR' });
                setIsSpeechModalVisible(false);
            }
        }
    });
    
    useSpeechRecognitionEvent('partialResult', (e) => {
        console.log('onSpeechPartialResults: ', e);
        const partialArray = (e?.results || []).map(result => result?.transcript || '');
        setPartialResults(partialArray);
        
        if (partialArray.length > 0) {
            setTranscript(partialArray[0]);
        }
    });

    // 이 함수는 MapView에서 직접 호출하지 않고, startNavigation을 호출하도록 변경
    const searchDestination = async (destinationName) => {
        try {
            if (!userLocation) {
                throw new Error('현재 위치가 설정되지 않았습니다.');
            }
            const coords = await getPoiCoordinates(destinationName, userLocation);
            if (isValidLatLng(coords)) {
                setDestination(coords);
                Speech.speak(`${destinationName} 검색이 완료되었습니다. 내비게이션을 시작합니다.`, { language: 'ko-KR' });
                await startNavigation(coords); // 내비게이션 시작
                setIsSpeechModalVisible(false);
                return true;
            }
        } catch (err) {
            console.error('목적지 검색 오류:', err);
            Speech.speak(err.message || '목적지 검색에 실패했습니다. 다시 시도해주세요.', { language: 'ko-KR' });
            setIsSpeechModalVisible(false);
            return false;
        }
    };

    const startListening = async () => {
        if (!ExpoSpeechRecognitionModule) {
            setError('ExpoSpeechRecognitionModule이 사용 불가능합니다.');
            Alert.alert('오류', '음성 인식 모듈을 사용할 수 없습니다.');
            console.log('Speech recognition module unavailable');
            return;
        }

        try {
            if (isListening) {
                console.log('Already listening, stopping first');
                await stopListening();
            }

            const { status } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
            console.log('Permission status:', status);
            if (status !== 'granted') {
                Speech.speak('마이크 권한이 거부되었습니다.', { language: 'ko-KR' });
                console.log('Microphone permission denied');
                return;
            }

            setIsListening(true);
            setRecognizedText('');
            setIsFinal(false);
            setTranscript('');
            resetStates();

            await ExpoSpeechRecognitionModule.start({
                lang: 'ko-KR',
                interimResults: true,
                continuous: false, // 연속 인식 비활성화
                maxSilenceTimeout: 3000, // 3초 침묵 후 자동 종료
            });
            console.log('Speech recognition started');
            Speech.speak('목적지를 말씀해주세요.', { language: 'ko-KR' });
            
            // 5초 후 강제 종료
            setTimeout(async () => {
                if (isListening) {
                    console.log('입력 시간이 초과되었습니다 다시 시도해주세요');
                    await stopListening();
                }
            }, 5000);
        } catch (error) {
            console.error('음성 인식 시작 에러:', error);
            setIsListening(false);
            setIsSpeechModalVisible(false);
            Alert.alert('음성 인식 오류', '음성 인식 시작 중 오류가 발생했습니다.');
            setError(JSON.stringify(error));
        }
    };

    const stopListening = async () => {
        if (!ExpoSpeechRecognitionModule) {
            console.log('Speech recognition module unavailable');
            return;
        }

        try {
            await ExpoSpeechRecognitionModule.stop();
            console.log('Speech recognition stopped');
            setIsListening(false);
            setIsSpeechModalVisible(false);
        } catch (error) {
            console.error('음성 인식 중지 에러:', error);
            setIsListening(false);
            setIsSpeechModalVisible(false);
            Alert.alert('음성 인식 오류', '음성 인식 중지 중 오류가 발생했습니다.');
        }
    };

    const resetStates = () => {
        setError('');
        setStarted('');
        setResults([]);
        setPartialResults([]);
        setEnd('');
        setRecognizedText('');
    };

    console.log('useSpeechRecognition: returning functions');

    return {
        recognizedText,
        transcript,
        isFinal,
        results,
        partialResults,
        started,
        end,
        error,
        isListening,
        startListening,
        stopListening,
    };
};

export default useSpeechRecognition;