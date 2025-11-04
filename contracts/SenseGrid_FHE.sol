pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SensorGridAggregator is ZamaEthereumConfig {
    struct SensorReading {
        euint32 encryptedValue;
        uint256 sensorId;
        uint256 timestamp;
        bool isVerified;
    }

    mapping(uint256 => SensorReading) public sensorReadings;
    mapping(uint256 => bool) public sensorExists;
    uint256[] public sensorIds;

    event ReadingSubmitted(uint256 indexed sensorId, uint256 timestamp);
    event ReadingVerified(uint256 indexed sensorId, uint256 timestamp);

    constructor() ZamaEthereumConfig() {}

    function submitReading(
        uint256 sensorId,
        externalEuint32 encryptedValue,
        bytes calldata inputProof
    ) external {
        require(!sensorExists[sensorId], "Sensor already registered");

        euint32 encrypted = FHE.fromExternal(encryptedValue, inputProof);
        require(FHE.isInitialized(encrypted), "Invalid encrypted input");

        sensorReadings[sensorId] = SensorReading({
            encryptedValue: encrypted,
            sensorId: sensorId,
            timestamp: block.timestamp,
            isVerified: false
        });

        FHE.allowThis(sensorReadings[sensorId].encryptedValue);
        FHE.makePubliclyDecryptable(sensorReadings[sensorId].encryptedValue);

        sensorExists[sensorId] = true;
        sensorIds.push(sensorId);

        emit ReadingSubmitted(sensorId, block.timestamp);
    }

    function verifyReading(
        uint256 sensorId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(sensorExists[sensorId], "Sensor not found");
        require(!sensorReadings[sensorId].isVerified, "Reading already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(sensorReadings[sensorId].encryptedValue);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        sensorReadings[sensorId].isVerified = true;
        emit ReadingVerified(sensorId, sensorReadings[sensorId].timestamp);
    }

    function getEncryptedReading(uint256 sensorId) external view returns (euint32) {
        require(sensorExists[sensorId], "Sensor not found");
        return sensorReadings[sensorId].encryptedValue;
    }

    function getReadingDetails(uint256 sensorId) external view returns (
        uint256 sensorId_,
        uint256 timestamp,
        bool isVerified
    ) {
        require(sensorExists[sensorId], "Sensor not found");
        SensorReading storage reading = sensorReadings[sensorId];
        return (reading.sensorId, reading.timestamp, reading.isVerified);
    }

    function getAllSensorIds() external view returns (uint256[] memory) {
        return sensorIds;
    }

    function computeAggregate(bytes calldata program) external {
        euint32[] memory operands = new euint32[](sensorIds.length);
        for (uint256 i = 0; i < sensorIds.length; i++) {
            operands[i] = sensorReadings[sensorIds[i]].encryptedValue;
        }

        FHE.run(program, operands);
    }

    function isSensorRegistered(uint256 sensorId) external view returns (bool) {
        return sensorExists[sensorId];
    }

    function isReadingVerified(uint256 sensorId) external view returns (bool) {
        require(sensorExists[sensorId], "Sensor not found");
        return sensorReadings[sensorId].isVerified;
    }
}


