import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableWithoutFeedback, GestureResponderEvent } from 'react-native';

const StatusDisplay = ({ 
  recognizedText, 
  started, 
  end, 
  error, 
  results, 
  partialResults, 
  startListening, 
  stopListening 
}) => {
  // 더블 탭 감지를 위한 변수
  let lastTap = null;
  const doubleTapDelay = 300; // 더블 탭으로 인식할 시간 간격 (밀리초)

  const handlePress = (event) => {
    const now = Date.now();
    
    if (lastTap && (now - lastTap) < doubleTapDelay) {
      // 더블 탭 감지됨 - 음성 인식 중지
      stopListening();
      lastTap = null;
    } else {
      // 싱글 탭 - 마지막 탭 시간 기록
      lastTap = now;
      
      // 더블 탭이 아니라면 일정 시간 후 싱글 탭으로 처리
      setTimeout(() => {
        if (lastTap && (Date.now() - lastTap) >= doubleTapDelay) {
          // 실제 싱글 탭으로 확인됨
          lastTap = null;
        }
      }, doubleTapDelay);
    }
  };

  const handleLongPress = () => {
    // 길게 누르면 음성 인식 시작
    startListening();
  };

  return (
    <TouchableWithoutFeedback
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={500} // 롱 프레스로 인식할 시간 (밀리초)
    >
      <View style={styles.container}>
        <Text style={styles.recognizedText}>{recognizedText}</Text>
        <Text style={styles.stat}>{`Started: ${started}`}</Text>
        <Text style={styles.stat}>{`End: ${end}`}</Text>
        <Text style={styles.stat}>{`Error: ${error}`}</Text>
        <Text style={styles.stat}>Results</Text>
        {results.map((result, index) => (
          <Text key={`result-${index}`} style={styles.stat}>{result}</Text>
        ))}
        <Text style={styles.stat}>Partial Results</Text>
        {partialResults.map((result, index) => (
          <Text key={`partial-result-${index}`} style={styles.stat}>{result}</Text>
        ))}
      </View>
    </TouchableWithoutFeedback>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  recognizedText: {
    fontSize: 18,
    marginBottom: 10,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 10,
    borderRadius: 5,
    marginTop: 20,
  },
  stat: {
    textAlign: 'left',
    color: '#B0171F',
    marginBottom: 1,
  }
});

export default StatusDisplay;