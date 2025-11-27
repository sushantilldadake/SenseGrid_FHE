import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useState, useEffect } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface SensorData {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [sensors, setSensors] = useState<SensorData[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingSensor, setCreatingSensor] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newSensorData, setNewSensorData] = useState({ name: "", value: "", location: "" });
  const [selectedSensor, setSelectedSensor] = useState<SensorData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [stats, setStats] = useState({ total: 0, verified: 0, avgValue: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ visible: true, status: "error", message: "FHEVM initialization failed" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const sensorsList: SensorData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          sensorsList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading sensor data:', e);
        }
      }
      
      setSensors(sensorsList);
      updateStats(sensorsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const updateStats = (sensors: SensorData[]) => {
    const total = sensors.length;
    const verified = sensors.filter(s => s.isVerified).length;
    const avgValue = sensors.length > 0 
      ? sensors.reduce((sum, s) => sum + s.publicValue1, 0) / sensors.length 
      : 0;
    
    setStats({ total, verified, avgValue });
  };

  const createSensor = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingSensor(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating sensor with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract");
      
      const sensorValue = parseInt(newSensorData.value) || 0;
      const sensorId = `sensor-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, sensorValue);
      
      const tx = await contract.createBusinessData(
        sensorId,
        newSensorData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newSensorData.location) || 0,
        0,
        "Environmental Sensor Data"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Sensor created!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewSensorData({ name: "", value: "", location: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingSensor(false); 
    }
  };

  const decryptData = async (sensorId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const sensorData = await contractRead.getBusinessData(sensorId);
      if (sensorData.isVerified) {
        const storedValue = Number(sensorData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(sensorId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(sensorId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Decrypted successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE system available" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>SenseGrid FHE</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <h2>Connect Wallet to Access Encrypted Sensor Network</h2>
            <p>Secure environmental data collection with fully homomorphic encryption</p>
            <div className="fhe-flow">
              <div className="flow-step">
                <div className="step-icon">1</div>
                <p>Connect wallet</p>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="step-icon">2</div>
                <p>Initialize FHE</p>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="step-icon">3</div>
                <p>View encrypted data</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading sensor network...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>SenseGrid FHE</h1>
          <p>Privacy-preserving environmental monitoring</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="status-btn">
            Check FHE Status
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + Add Sensor
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panel">
          <div className="stat-card">
            <h3>Total Sensors</h3>
            <div className="stat-value">{stats.total}</div>
          </div>
          <div className="stat-card">
            <h3>Verified Data</h3>
            <div className="stat-value">{stats.verified}</div>
          </div>
          <div className="stat-card">
            <h3>Avg Value</h3>
            <div className="stat-value">{stats.avgValue.toFixed(1)}</div>
          </div>
        </div>
        
        <div className="sensor-list">
          <div className="list-header">
            <h2>Sensor Nodes</h2>
            <button onClick={loadData} className="refresh-btn">
              Refresh
            </button>
          </div>
          
          {sensors.length === 0 ? (
            <div className="empty-list">
              <p>No sensors found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Add First Sensor
              </button>
            </div>
          ) : (
            <div className="sensor-grid">
              {sensors.map((sensor, index) => (
                <div 
                  className={`sensor-card ${selectedSensor?.id === sensor.id ? "selected" : ""}`}
                  key={index}
                  onClick={() => setSelectedSensor(sensor)}
                >
                  <div className="sensor-name">{sensor.name}</div>
                  <div className="sensor-meta">
                    <span>Location: {sensor.publicValue1}</span>
                    <span>{new Date(sensor.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  <div className="sensor-status">
                    {sensor.isVerified ? (
                      <span className="verified">Verified: {sensor.decryptedValue}</span>
                    ) : (
                      <span className="encrypted">🔒 Encrypted</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Add New Sensor</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-modal">
                &times;
              </button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Sensor Name</label>
                <input 
                  type="text" 
                  value={newSensorData.name} 
                  onChange={(e) => setNewSensorData({...newSensorData, name: e.target.value})}
                  placeholder="Enter sensor name"
                />
              </div>
              
              <div className="form-group">
                <label>Sensor Value (FHE Encrypted)</label>
                <input 
                  type="number" 
                  value={newSensorData.value} 
                  onChange={(e) => setNewSensorData({...newSensorData, value: e.target.value})}
                  placeholder="Enter numeric value"
                />
              </div>
              
              <div className="form-group">
                <label>Location Code (Public)</label>
                <input 
                  type="number" 
                  value={newSensorData.location} 
                  onChange={(e) => setNewSensorData({...newSensorData, location: e.target.value})}
                  placeholder="Enter location code"
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">
                Cancel
              </button>
              <button 
                onClick={createSensor} 
                disabled={creatingSensor || isEncrypting || !newSensorData.name || !newSensorData.value}
                className="submit-btn"
              >
                {creatingSensor || isEncrypting ? "Encrypting..." : "Add Sensor"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {selectedSensor && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>Sensor Details</h2>
              <button onClick={() => setSelectedSensor(null)} className="close-modal">
                &times;
              </button>
            </div>
            
            <div className="modal-body">
              <div className="sensor-info">
                <div className="info-row">
                  <span>Name:</span>
                  <strong>{selectedSensor.name}</strong>
                </div>
                <div className="info-row">
                  <span>Creator:</span>
                  <strong>{selectedSensor.creator.substring(0, 6)}...{selectedSensor.creator.substring(38)}</strong>
                </div>
                <div className="info-row">
                  <span>Location:</span>
                  <strong>{selectedSensor.publicValue1}</strong>
                </div>
                <div className="info-row">
                  <span>Timestamp:</span>
                  <strong>{new Date(selectedSensor.timestamp * 1000).toLocaleString()}</strong>
                </div>
              </div>
              
              <div className="data-section">
                <h3>Sensor Data</h3>
                <div className="data-row">
                  <span>Status:</span>
                  <strong>
                    {selectedSensor.isVerified ? (
                      <span className="verified">Verified: {selectedSensor.decryptedValue}</span>
                    ) : (
                      <span className="encrypted">🔒 FHE Encrypted</span>
                    )}
                  </strong>
                </div>
                
                <button 
                  onClick={() => decryptData(selectedSensor.id)}
                  disabled={isDecrypting}
                  className={`decrypt-btn ${selectedSensor.isVerified ? 'verified' : ''}`}
                >
                  {isDecrypting ? "Decrypting..." : selectedSensor.isVerified ? "✅ Verified" : "🔓 Decrypt"}
                </button>
                
                <div className="fhe-info">
                  <p>Data is encrypted using FHE and can be processed without decryption</p>
                </div>
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setSelectedSensor(null)} className="close-btn">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      
      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;