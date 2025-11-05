import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface SensorData {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  decryptedValue: number;
  isVerified: boolean;
  location: string;
}

interface SensorStats {
  totalSensors: number;
  verifiedData: number;
  avgValue: number;
  recentData: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [sensors, setSensors] = useState<SensorData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingSensor, setCreatingSensor] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newSensorData, setNewSensorData] = useState({ name: "", value: "", location: "", description: "" });
  const [selectedSensor, setSelectedSensor] = useState<SensorData | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [stats, setStats] = useState<SensorStats>({ totalSensors: 0, verifiedData: 0, avgValue: 0, recentData: 0 });
  const [showFAQ, setShowFAQ] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
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
    
    setIsRefreshing(true);
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
            decryptedValue: Number(businessData.decryptedValue) || 0,
            isVerified: businessData.isVerified,
            location: `Zone ${Number(businessData.publicValue2) || 0}`
          });
        } catch (e) {
          console.error('Error loading sensor data:', e);
        }
      }
      
      setSensors(sensorsList);
      calculateStats(sensorsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const calculateStats = (sensors: SensorData[]) => {
    const totalSensors = sensors.length;
    const verifiedData = sensors.filter(s => s.isVerified).length;
    const avgValue = sensors.length > 0 
      ? sensors.reduce((sum, s) => sum + s.publicValue1, 0) / sensors.length 
      : 0;
    const recentData = sensors.filter(s => 
      Date.now()/1000 - s.timestamp < 60 * 60 * 24
    ).length;

    setStats({ totalSensors, verifiedData, avgValue, recentData });
  };

  const createSensor = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingSensor(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating sensor with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract");
      
      const value = parseInt(newSensorData.value) || 0;
      const businessId = `sensor-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, value);
      
      const tx = await contract.createBusinessData(
        businessId,
        newSensorData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        value,
        Math.floor(Math.random() * 10) + 1,
        newSensorData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Processing transaction..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Sensor created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewSensorData({ name: "", value: "", location: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingSensor(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setDecryptedValue(storedValue);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      const numValue = Number(clearValue);
      setDecryptedValue(numValue);
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return numValue;
      
    } catch (e: any) { 
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed" 
      });
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
      
      const isAvail = await contract.isAvailable();
      if (isAvail) {
        setTransactionStatus({ visible: true, status: "success", message: "System available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderStats = () => {
    return (
      <div className="stats-panels">
        <div className="panel metal-panel">
          <h3>Total Sensors</h3>
          <div className="stat-value">{stats.totalSensors}</div>
          <div className="stat-trend">+{stats.recentData} today</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>Verified Data</h3>
          <div className="stat-value">{stats.verifiedData}/{stats.totalSensors}</div>
          <div className="stat-trend">FHE Verified</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>Avg Value</h3>
          <div className="stat-value">{stats.avgValue.toFixed(1)}</div>
          <div className="stat-trend">Encrypted</div>
        </div>
      </div>
    );
  };

  const renderSensorChart = (sensor: SensorData) => {
    const value = sensor.isVerified ? sensor.decryptedValue : decryptedValue || sensor.publicValue1;
    
    return (
      <div className="sensor-chart">
        <div className="chart-header">
          <h4>Sensor Reading</h4>
          <div className="chart-value">{value}</div>
        </div>
        <div className="chart-visual">
          <div 
            className="chart-bar" 
            style={{ height: `${Math.min(100, value)}%` }}
          >
            <div className="bar-glow"></div>
          </div>
        </div>
        <div className="chart-labels">
          <span>0</span>
          <span>50</span>
          <span>100</span>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-icon">1</div>
          <div className="step-content">
            <h4>Data Encryption</h4>
            <p>Sensor data encrypted with FHE 🔒</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-icon">2</div>
          <div className="step-content">
            <h4>Secure Aggregation</h4>
            <p>Gateway aggregates encrypted data</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-icon">3</div>
          <div className="step-content">
            <h4>Privacy-Preserving</h4>
            <p>Location privacy maintained</p>
          </div>
        </div>
      </div>
    );
  };

  const renderFAQ = () => {
    return (
      <div className="faq-section">
        <h3>FHE Sensor Grid FAQ</h3>
        <div className="faq-item">
          <h4>How does FHE protect my data?</h4>
          <p>Fully Homomorphic Encryption allows computations on encrypted data without decryption, preserving privacy.</p>
        </div>
        <div className="faq-item">
          <h4>Is location data secure?</h4>
          <p>We only store zone identifiers, never exact coordinates. Actual locations remain private.</p>
        </div>
        <div className="faq-item">
          <h4>How is data verified?</h4>
          <p>Using zero-knowledge proofs to validate decryption without revealing sensitive information.</p>
        </div>
        <div className="faq-item">
          <h4>What data types are supported?</h4>
          <p>Currently only integer values can be encrypted and processed homomorphically.</p>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>SenseGrid FHE</h1>
            <div className="logo-subtitle">Privacy-Preserving Sensor Network</div>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Secure Sensor Network Access</h2>
            <p>Connect your wallet to initialize the encrypted sensor grid system.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect wallet to begin</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system initializes automatically</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>View or add encrypted sensor data</p>
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
        <p className="loading-note">Securing sensor data processing</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted sensor grid...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>SenseGrid FHE</h1>
          <div className="logo-subtitle">Privacy-Preserving Sensor Network</div>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + Add Sensor
          </button>
          <button 
            onClick={() => setShowFAQ(!showFAQ)}
            className="faq-btn"
          >
            {showFAQ ? "Hide FAQ" : "Show FAQ"}
          </button>
          <button 
            onClick={checkAvailability}
            className="check-btn"
          >
            Check System
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>Sensor Network Overview</h2>
          {renderStats()}
          
          <div className="panel metal-panel full-width">
            <h3>FHE Data Flow</h3>
            {renderFHEProcess()}
          </div>
        </div>
        
        <div className="sensors-section">
          <div className="section-header">
            <h2>Sensor Nodes</h2>
            <div className="header-actions">
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh Data"}
              </button>
            </div>
          </div>
          
          <div className="sensors-list">
            {sensors.length === 0 ? (
              <div className="no-sensors">
                <p>No sensors registered</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Add First Sensor
                </button>
              </div>
            ) : sensors.map((sensor, index) => (
              <div 
                className={`sensor-item ${selectedSensor?.id === sensor.id ? "selected" : ""} ${sensor.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedSensor(sensor)}
              >
                <div className="sensor-title">{sensor.name}</div>
                <div className="sensor-meta">
                  <span>Location: {sensor.location}</span>
                  <span>Added: {new Date(sensor.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="sensor-status">
                  {sensor.isVerified ? 
                    <span className="status-verified">✅ Verified: {sensor.decryptedValue}</span> : 
                    <span className="status-pending">🔒 Encrypted</span>
                  }
                </div>
                <div className="sensor-creator">Owner: {sensor.creator.substring(0, 6)}...{sensor.creator.substring(38)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showFAQ && (
        <div className="faq-modal">
          <div className="faq-content">
            <button className="close-faq" onClick={() => setShowFAQ(false)}>×</button>
            {renderFAQ()}
          </div>
        </div>
      )}
      
      {showCreateModal && (
        <ModalCreateSensor 
          onSubmit={createSensor} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingSensor} 
          sensorData={newSensorData} 
          setSensorData={setNewSensorData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedSensor && (
        <SensorDetailModal 
          sensor={selectedSensor} 
          onClose={() => { 
            setSelectedSensor(null); 
            setDecryptedValue(null); 
          }} 
          decryptedValue={decryptedValue} 
          setDecryptedValue={setDecryptedValue} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedSensor.id)}
          renderSensorChart={renderSensorChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateSensor: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  sensorData: any;
  setSensorData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, sensorData, setSensorData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setSensorData({ ...sensorData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-sensor-modal">
        <div className="modal-header">
          <h2>Register New Sensor</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE Encryption</strong>
            <p>Sensor value will be encrypted using Fully Homomorphic Encryption</p>
          </div>
          
          <div className="form-group">
            <label>Sensor Name *</label>
            <input 
              type="text" 
              name="name" 
              value={sensorData.name} 
              onChange={handleChange} 
              placeholder="Enter sensor name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Sensor Value (Integer) *</label>
            <input 
              type="number" 
              name="value" 
              value={sensorData.value} 
              onChange={handleChange} 
              placeholder="Enter sensor reading..." 
              min="0"
            />
            <div className="data-type-label">FHE Encrypted</div>
          </div>
          
          <div className="form-group">
            <label>Location Zone *</label>
            <input 
              type="text" 
              name="location" 
              value={sensorData.location} 
              onChange={handleChange} 
              placeholder="Enter zone identifier..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={sensorData.description} 
              onChange={handleChange} 
              placeholder="Sensor description..." 
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !sensorData.name || !sensorData.value || !sensorData.location} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Register Sensor"}
          </button>
        </div>
      </div>
    </div>
  );
};

const SensorDetailModal: React.FC<{
  sensor: SensorData;
  onClose: () => void;
  decryptedValue: number | null;
  setDecryptedValue: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderSensorChart: (sensor: SensorData) => JSX.Element;
}> = ({ sensor, onClose, decryptedValue, setDecryptedValue, isDecrypting, decryptData, renderSensorChart }) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) { 
      setDecryptedValue(null); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedValue(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="sensor-detail-modal">
        <div className="modal-header">
          <h2>Sensor Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="sensor-info">
            <div className="info-row">
              <div className="info-item">
                <span>Name:</span>
                <strong>{sensor.name}</strong>
              </div>
              <div className="info-item">
                <span>Location:</span>
                <strong>{sensor.location}</strong>
              </div>
            </div>
            
            <div className="info-row">
              <div className="info-item">
                <span>Owner:</span>
                <strong>{sensor.creator.substring(0, 6)}...{sensor.creator.substring(38)}</strong>
              </div>
              <div className="info-item">
                <span>Registered:</span>
                <strong>{new Date(sensor.timestamp * 1000).toLocaleDateString()}</strong>
              </div>
            </div>
            
            <div className="info-item full-width">
              <span>Description:</span>
              <p>{sensor.description || "No description provided"}</p>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Sensor Data</h3>
            
            <div className="data-row">
              <div className="data-label">Encrypted Value:</div>
              <div className="data-value">
                {sensor.isVerified ? 
                  `${sensor.decryptedValue} (Verified)` : 
                  decryptedValue !== null ? 
                  `${decryptedValue} (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(sensor.isVerified || decryptedValue !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Decrypting..."
                ) : sensor.isVerified ? (
                  "✅ Verified"
                ) : decryptedValue !== null ? (
                  "🔄 Re-decrypt"
                ) : (
                  "🔓 Decrypt Value"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Data Processing</strong>
                <p>Sensor data remains encrypted during aggregation. Decryption requires explicit permission.</p>
              </div>
            </div>
          </div>
          
          {(sensor.isVerified || decryptedValue !== null) && (
            <div className="chart-section">
              <h3>Data Visualization</h3>
              {renderSensorChart(sensor)}
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!sensor.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


