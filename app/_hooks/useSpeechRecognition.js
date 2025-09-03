import { useState, useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

const PLACE_SUFFIXES = ['역','공원','해수욕장','해변','시장','백화점','병원','대학교','터미널','공항','시청','구청'];
const CITY_HINTS = ['부산','서울','인천','대구','대전','광주','울산','제주','수원','성남','용인','고양','창원'];
const BANWORDS = ['저녁','아침','점심','전역','재생','정지','취소']; // 목적지 아님

function scoreTranscript(t, confidence = 0) {
  const raw = (t || '').trim();
  const norm = raw.replace(/\s+/g, '');
  if (!norm) return -Infinity;
  let s = (confidence || 0) * 100;
  if (norm.length >= 3) s += 10;                      // 너무 짧은 단어 벌점 방지
  if (PLACE_SUFFIXES.some(suf => norm.endsWith(suf))) s += 25;
  if (CITY_HINTS.some(c => norm.includes(c))) s += 12;
  if (BANWORDS.includes(norm)) s -= 40;               // “저녁/전역” 등은 큰 벌점
  if (/^[가-힣]{1,2}$/.test(norm)) s -= 15;           // 1~2글자 짧은 단어는 감점
  return s;
}

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
          // 1) 후보 목록 [{transcript, confidence}]
          const alts =
            (e?.results || [])
              .map(r => ({
                transcript: (r?.transcript || '').trim(),
                confidence: Number.isFinite(r?.confidence) ? r.confidence : 0.5,
              }))
              .filter(a => !!a.transcript);
        
           if (alts.length === 0) return;
        
          // 2) 시스템 프롬프트 문구 제거(있다면)
          const systemPhrases = [
            '목적지를 말씀해 주세요','시작하려면 화면을 눌러 주세요','목적지를 말해주세요','음성 검색을 시작합니다'
          ];
          for (const a of alts) {
            for (const phrase of systemPhrases) {
              a.transcript = a.transcript.replace(new RegExp(phrase, 'gi'), '').trim();
            }
          }
        
          // 3) 점수화하여 최적 후보 선택
          const scored = alts
            .map(a => ({ ...a, score: scoreTranscript(a.transcript, a.confidence) }))
            .sort((x, y) => (y.score - x.score) || ((y.transcript?.length||0) - (x.transcript?.length||0)));
          const best = scored[0];
          console.log('🎤 pickBestTranscript =>', best?.transcript, 'score=', best?.score, scored);
        
          // 4) 진행 중에는 화면에 최신(최고 점수) 후보만 임시 반영
          setTranscript(best?.transcript || '');
          // 5) 최종 전환 시에만 확정
          if (e?.isFinal) {
            const finalPick = (best?.transcript || '').trim();
            if (finalPick) {
              setRecognizedText(finalPick);
              setTranscript(finalPick);
              setIsFinal(true);
              stopListening();
            } else {
              Speech.speak('목적지를 인식하지 못했습니다. 다시 말씀해주세요.', { language: 'ko-KR' });
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