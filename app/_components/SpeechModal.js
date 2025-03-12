import React from 'react';
import RNModal from 'react-native-modal';
import { View, Text, StyleSheet } from 'react-native';

const SpeechModal = ({ isVisible }) => (
    <RNModal
        isVisible={isVisible}
        style={styles.modalContainer}
        backdropOpacity={0}
        animationIn="fadeIn"
        animationOut="fadeOut"
        avoidKeyboard={true}
        coverScreen={false}
        propagateSwipe={true}
    >
        <View style={styles.modalContent} pointerEvents="box-only">
            <Text style={styles.modalText}>음성 인식 중...</Text>
        </View>
    </RNModal>
);

const styles = StyleSheet.create({
    modalContainer: {
        justifyContent: 'flex-start', // 변경: 모달을 컨테이너 상단에 배치
        alignItems: 'center',
        margin: 0,
        pointerEvents: 'none',
        marginTop: 150, // 추가: 모달을 아래로 100px 이동
    },
    modalContent: {
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        padding: 20,
        borderRadius: 10,
    },
    modalText: {
        color: 'white',
        fontSize: 16,
    },
});

export default SpeechModal;