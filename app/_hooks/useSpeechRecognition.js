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
    const listeningTimeoutRef = useRef(null);

    // 이벤트 핸들러들
    useSpeechRecognitionEvent('start', () => {
        console.log('onSpeechStart');
        setIsFinal(false);
        setError('');
        setRecognizedText(''); // 이전 결과 초기화
        setTranscript(''); // 이전 transcript 초기화
    });
    
    useSpeechRecognitionEvent('end', () => {
        console.log('onSpeechEnd');
        setIsListening(false);
        
        // 타임아웃 클리어
        if (listeningTimeoutRef.current) {
            clearTimeout(listeningTimeoutRef.current);
            listeningTimeoutRef.current = null;
        }
    });
    
    useSpeechRecognitionEvent('error', (e) => {
        console.log('onSpeechError:', e);
        setError(JSON.stringify(e?.error || 'Unknown error'));
        setIsListening(false);
        
        if (listeningTimeoutRef.current) {
            clearTimeout(listeningTimeoutRef.current);
            listeningTimeoutRef.current = null;
        }
        
        if (e?.error === 'no-speech') {
            Speech.speak('음성이 감지되지 않았습니다. 다시 시도해주세요.', { language: 'ko-KR' });
        }
    });
    
    useSpeechRecognitionEvent('result', (e) => {
        console.log('onSpeechResults:', e);
        const resultsArray = (e?.results || []).map(result => result?.transcript || '');
        
        if (resultsArray.length > 0) {
            // 마지막 결과를 가져옴 (가장 최근/정확한 결과)
            const latestResult = resultsArray[resultsArray.length - 1];
            
            // 임시 텍스트 업데이트
            setTranscript(latestResult);
            
            if (e?.isFinal) {
                // 최종 결과 처리
                const finalText = latestResult.trim();
                
                // 시스템 메시지 필터링 (선택적)
                const systemPhrases = [
                    '목적지를 말씀해 주세요',
                    '시작하려면 화면을 눌러 주세요',
                    '목적지를 말해주세요',
                    '음성 검색을 시작합니다'
                ];
                
                let cleanedText = finalText;
                for (const phrase of systemPhrases) {
                    cleanedText = cleanedText.replace(new RegExp(phrase, 'gi'), '').trim();
                }
                
                // 정제된 텍스트가 유효한 경우에만 설정
                if (cleanedText && cleanedText.length > 0) {
                    console.log('최종 음성 인식 결과:', cleanedText);
                    setRecognizedText(cleanedText);
                    setTranscript(cleanedText);
                    setIsFinal(true);
                    
                    // 음성 인식 자동 종료
                    stopListening();
                } else if (finalText && finalText.length > 0) {
                    // 필터링 후 텍스트가 없어진 경우 원본 사용
                    console.log('원본 음성 인식 결과 사용:', finalText);
                    setRecognizedText(finalText);
                    setTranscript(finalText);
                    setIsFinal(true);
                    
                    // 음성 인식 자동 종료
                    stopListening();
                } else {
                    console.log('유효한 목적지가 없습니다.');
                    Speech.speak('목적지를 인식하지 못했습니다. 다시 말씀해주세요.', { language: 'ko-KR' });
                }
            }
        }
    });
    
    useSpeechRecognitionEvent('partialResult', (e) => {
        const partialArray = (e?.results || []).map(result => result?.transcript || '');
        if (partialArray.length > 0) {
            const latestPartial = partialArray[partialArray.length - 1];
            setTranscript(latestPartial);
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

            // 상태 초기화
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
            listeningTimeoutRef.current = setTimeout(async () => {
                if (isListening) {
                    console.log('입력 시간 초과');
                    await stopListening();
                    Speech.speak('시간이 초과되었습니다. 다시 시도해주세요.', { language: 'ko-KR' });
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
            if (listeningTimeoutRef.current) {
                clearTimeout(listeningTimeoutRef.current);
                listeningTimeoutRef.current = null;
            }
            
            await ExpoSpeechRecognitionModule.stop();
            console.log('Speech recognition stopped');
            setIsListening(false);
        } catch (error) {
            console.error('음성 인식 중지 에러:', error);
            setIsListening(false);
        }
    }, []);

    // 텍스트 재설정 (새로운 검색을 위해)
    const resetRecognizedText = useCallback(() => {
        setRecognizedText('');
        setTranscript('');
        setIsFinal(false);
        setError('');
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
            if (listeningTimeoutRef.current) {
                clearTimeout(listeningTimeoutRef.current);
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
        resetRecognizedText,
    };
};

export default useSpeechRecognition;