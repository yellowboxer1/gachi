import { useState, useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

const useSpeechRecognition = ({ userLocation }) => {
    const [recognizedText, setRecognizedText] = useState('');
    const [transcript, setTranscript] = useState('');
    const [isFinal, setIsFinal] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [error, setError] = useState('');
    
    const isInitialized = useRef(false);

    // 이벤트 핸들러들
    useSpeechRecognitionEvent('start', () => {
        console.log('onSpeechStart');
        setIsFinal(false);
        setError('');
    });
    
    useSpeechRecognitionEvent('end', () => {
        console.log('onSpeechEnd');
        setIsListening(false);
    });
    
    useSpeechRecognitionEvent('error', (e) => {
        console.log('onSpeechError:', e);
        setError(JSON.stringify(e?.error || 'Unknown error'));
        setIsListening(false);
        
        if (e?.error === 'no-speech') {
            Speech.speak('음성이 감지되지 않았습니다. 다시 시도해주세요.', { language: 'ko-KR' });
        }
    });
    
    useSpeechRecognitionEvent('result', (e) => {
        console.log('onSpeechResults:', e);
        const resultsArray = (e?.results || []).map(result => result?.transcript || '');
        
        if (e?.isFinal && resultsArray.length > 0) {
            const filteredResults = resultsArray
                .map(text => text
                    .replace(/목적지를\s*말씀해\s*주세요/g, '')
                    .replace(/시작하려면\s*화면을\s*눌러\s*주세요/g, '')
                    .trim()
                )
                .filter(text => text.length > 0);
                
            const finalText = filteredResults[filteredResults.length - 1] || '';
            
            if (finalText) {
                console.log('최종 음성 인식 결과:', finalText);
                setRecognizedText(finalText);
                setTranscript(finalText);
                setIsFinal(true);
            } else {
                console.log('유효한 목적지가 없습니다.');
                Speech.speak('목적지를 인식하지 못했습니다. 다시 말씀해주세요.', { language: 'ko-KR' });
            }
        }
    });
    
    useSpeechRecognitionEvent('partialResult', (e) => {
        const partialArray = (e?.results || []).map(result => result?.transcript || '');
        if (partialArray.length > 0) {
            setTranscript(partialArray[0]);
        }
    });

    // 음성 인식 시작
    const startListening = useCallback(async () => {
        if (!ExpoSpeechRecognitionModule) {
            setError('음성 인식 모듈을 사용할 수 없습니다.');
            Alert.alert('오류', '음성 인식 모듈을 사용할 수 없습니다.');
            return;
        }

        try {
            // 이미 듣고 있으면 중지
            if (isListening) {
                await stopListening();
            }

            const { status } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
            console.log('Permission status:', status);
            
            if (status !== 'granted') {
                Speech.speak('마이크 권한이 거부되었습니다.', { language: 'ko-KR' });
                return;
            }

            setIsListening(true);
            setRecognizedText('');
            setIsFinal(false);
            setTranscript('');
            setError('');

            await ExpoSpeechRecognitionModule.start({
                lang: 'ko-KR',
                interimResults: true,
                continuous: false,
                maxSilenceTimeout: 3000,
            });
            
            console.log('Speech recognition started');
            Speech.speak('목적지를 말씀해주세요.', { language: 'ko-KR' });
            
            // 10초 후 자동 종료
            setTimeout(async () => {
                if (isListening) {
                    console.log('입력 시간 초과');
                    await stopListening();
                }
            }, 10000);
        } catch (error) {
            console.error('음성 인식 시작 에러:', error);
            setIsListening(false);
            Alert.alert('음성 인식 오류', '음성 인식 시작 중 오류가 발생했습니다.');
            setError(JSON.stringify(error));
        }
    }, [isListening]);

    // 음성 인식 중지
    const stopListening = useCallback(async () => {
        if (!ExpoSpeechRecognitionModule) {
            return;
        }

        try {
            await ExpoSpeechRecognitionModule.stop();
            console.log('Speech recognition stopped');
            setIsListening(false);
        } catch (error) {
            console.error('음성 인식 중지 에러:', error);
            setIsListening(false);
        }
    }, []);

    // 컴포넌트 언마운트 시 정리
    useEffect(() => {
        isInitialized.current = true;
        console.log('useSpeechRecognition: initialized');
        
        return () => {
            isInitialized.current = false;
            if (isListening) {
                stopListening();
            }
        };
    }, []);

    return {
        recognizedText,
        transcript,
        isFinal,
        error,
        isListening,
        startListening,
        stopListening,
    };
};

export default useSpeechRecognition;