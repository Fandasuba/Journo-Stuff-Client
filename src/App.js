import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, AlertCircle, TrendingUp, FileText, Calendar, CheckCircle } from 'lucide-react';

const API_URL = 'http://localhost:3001/api';

export default function NewsDashboard() {
  const [lawsuits, setLawsuits] = useState([]);
  const [stats, setStats] = useState(null);
  const [lastScan, setLastScan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState({ priority: 'all', view: 'recent' });
  const [searchCompany, setSearchCompany] = useState('');
  const [customDateRange, setCustomDateRange] = useState({ from: '', to: '' });
  
  // SSE-specific state
  const [scanProgress, setScanProgress] = useState({
    status: '',
    currentCompany: '',
    companyId: '',
    progress: 0,
    total: 0,
    percentage: 0,
    casesFound: 0,
    message: ''
  });
  
  const eventSourceRef = useRef(null);

  useEffect(() => {
    fetchData();
    fetchStats();
    fetchScanStatus();
    
    // Cleanup on unmount
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [filter]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const endpoint = filter.view === 'recent' ? '/lawsuits/recent' : '/lawsuits';
      const params = new URLSearchParams();
      if (filter.priority !== 'all') params.append('priority', filter.priority);
      
      const response = await fetch(`${API_URL}${endpoint}?${params}`);
      const data = await response.json();
      setLawsuits(data.data || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    }
    setLoading(false);
  };

  const fetchStats = async () => {
    try {
      const response = await fetch(`${API_URL}/lawsuits/stats`);
      const data = await response.json();
      setStats(data.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const fetchScanStatus = async () => {
    try {
      const response = await fetch(`${API_URL}/scan/status`);
      const data = await response.json();
      setLastScan(data.lastScan);
    } catch (error) {
      console.error('Error fetching scan status:', error);
    }
  };

  const calculateHoursBack = (fromDate, toDate) => {
    const from = new Date(fromDate);
    const to = new Date(toDate);
    return Math.floor((to - from) / (1000 * 60 * 60));
  };

  const triggerScan = async () => {
    setScanning(true);
    setScanProgress({
      status: 'initializing',
      currentCompany: '',
      companyId: '',
      progress: 0,
      total: 0,
      percentage: 0,
      casesFound: 0,
      message: 'Initializing scan...'
    });
    
    try {
      const hoursBack = customDateRange.from && customDateRange.to 
        ? calculateHoursBack(customDateRange.from, customDateRange.to)
        : 168;
      
      const response = await fetch(`${API_URL}/scan/lawsuits-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hoursBack })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            
            if (data.status === 'started') {
              setScanProgress({
                status: 'started',
                message: data.message,
                total: data.total,
                progress: 0,
                percentage: 0,
                currentCompany: '',
                companyId: '',
                casesFound: 0
              });
            } else if (data.status === 'searching') {
              setScanProgress(prev => ({
                ...prev,
                status: 'searching',
                currentCompany: data.company,
                companyId: data.companyId,
                progress: data.progress,
                total: data.total,
                percentage: data.percentage,
                message: `Searching ${data.company}... (${data.progress}/${data.total})`
              }));
            } else if (data.status === 'company-complete') {
              setScanProgress(prev => ({
                ...prev,
                status: 'company-complete',
                casesFound: prev.casesFound + data.casesFound,
                message: `✓ ${data.company}: ${data.casesFound} cases found`
              }));
            } else if (data.status === 'saving') {
              setScanProgress(prev => ({
                ...prev,
                status: 'saving',
                message: data.message
              }));
            } else if (data.status === 'complete') {
              setScanProgress({
                status: 'complete',
                message: data.message,
                currentCompany: '',
                companyId: '',
                progress: 0,
                total: 0,
                percentage: 100,
                casesFound: data.found
              });
              
              setTimeout(() => {
                fetchData();
                fetchStats();
                fetchScanStatus();
                setScanning(false);
              }, 2000);
            } else if (data.status === 'error') {
              setScanProgress({
                status: 'error',
                message: `Error: ${data.message}`,
                currentCompany: '',
                companyId: '',
                progress: 0,
                total: 0,
                percentage: 0,
                casesFound: 0
              });
              setScanning(false);
            }
          }
        }
      }
    } catch (error) {
      console.error('Scan error:', error);
      setScanProgress({
        status: 'error',
        message: 'Scan failed: ' + error.message,
        currentCompany: '',
        companyId: '',
        progress: 0,
        total: 0,
        percentage: 0,
        casesFound: 0
      });
      setScanning(false);
    }
  };

  const searchSpecificCompany = async () => {
    if (!searchCompany) {
      alert('Please enter a company ID');
      return;
    }
    
    setScanning(true);
    setScanProgress({
      status: 'initializing',
      currentCompany: searchCompany,
      companyId: searchCompany,
      progress: 0,
      total: 0,
      percentage: 0,
      casesFound: 0,
      message: `Initializing search for ${searchCompany}...`
    });
    
    try {
      const hoursBack = customDateRange.from && customDateRange.to
        ? calculateHoursBack(customDateRange.from, customDateRange.to)
        : 8760;
        
      const response = await fetch(`${API_URL}/scan/company-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          companyId: searchCompany, 
          hoursBack 
        })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            
            if (data.status === 'started') {
              setScanProgress({
                status: 'started',
                currentCompany: data.company,
                companyId: searchCompany,
                message: data.message,
                progress: 0,
                total: 0,
                percentage: 0,
                casesFound: 0
              });
            } else if (data.status === 'searching') {
              setScanProgress(prev => ({
                ...prev,
                status: 'searching',
                message: `Searching: ${data.searchTerm} (${data.progress}/${data.total})`
              }));
            } else if (data.status === 'found') {
              setScanProgress(prev => ({
                ...prev,
                status: 'found',
                casesFound: prev.casesFound + data.casesFound,
                message: `✓ Found ${data.casesFound} cases for ${data.searchTerm}`
              }));
            } else if (data.status === 'saving') {
              setScanProgress(prev => ({
                ...prev,
                status: 'saving',
                message: data.message
              }));
            } else if (data.status === 'complete') {
              setScanProgress({
                status: 'complete',
                currentCompany: data.company,
                companyId: searchCompany,
                message: data.message,
                progress: 0,
                total: 0,
                percentage: 100,
                casesFound: data.found
              });
              
              setTimeout(() => {
                fetchData();
                fetchStats();
                setSearchCompany('');
                setScanning(false);
              }, 2000);
            } else if (data.status === 'error') {
              setScanProgress({
                status: 'error',
                message: `Error: ${data.message}`,
                currentCompany: '',
                companyId: '',
                progress: 0,
                total: 0,
                percentage: 0,
                casesFound: 0
              });
              setScanning(false);
            }
          }
        }
      }
    } catch (error) {
      console.error('Search error:', error);
      setScanProgress({
        status: 'error',
        message: 'Search failed: ' + error.message,
        currentCompany: '',
        companyId: '',
        progress: 0,
        total: 0,
        percentage: 0,
        casesFound: 0
      });
      setScanning(false);
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-800 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-gray-100 text-gray-800 border-gray-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Gaming News Intelligence Dashboard
          </h1>
          <p className="text-gray-600">
            Automated tracking of lawsuits, trademarks, and industry signals
          </p>
        </div>

        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white p-6 rounded-lg shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Cases</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                </div>
                <FileText className="w-8 h-8 text-blue-500" />
              </div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">High Priority</p>
                  <p className="text-2xl font-bold text-red-600">{stats.high_priority}</p>
                </div>
                <AlertCircle className="w-8 h-8 text-red-500" />
              </div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Last 7 Days</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.last_week}</p>
                </div>
                <Calendar className="w-8 h-8 text-green-500" />
              </div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Last 30 Days</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.last_month}</p>
                </div>
                <TrendingUp className="w-8 h-8 text-purple-500" />
              </div>
            </div>
          </div>
        )}

        <div className="bg-white p-4 rounded-lg shadow mb-6">
          <div className="mb-4 pb-4 border-b">
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Custom Date Range (optional)
            </label>
            <div className="flex gap-4 items-center flex-wrap">
              <div>
                <label className="text-xs text-gray-600">From:</label>
                <input
                  type="date"
                  value={customDateRange.from}
                  onChange={(e) => setCustomDateRange({...customDateRange, from: e.target.value})}
                  className="border border-gray-300 rounded px-3 py-2 ml-2"
                  disabled={scanning}
                />
              </div>
              <div>
                <label className="text-xs text-gray-600">To:</label>
                <input
                  type="date"
                  value={customDateRange.to}
                  onChange={(e) => setCustomDateRange({...customDateRange, to: e.target.value})}
                  className="border border-gray-300 rounded px-3 py-2 ml-2"
                  disabled={scanning}
                />
              </div>
              <button
                onClick={() => setCustomDateRange({from: '', to: ''})}
                className="text-sm text-blue-600 hover:text-blue-800"
                disabled={scanning}
              >
                Clear Dates
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Leave empty to use default range (7 days for full scan, 1 year for company search)
            </p>
          </div>

          {scanProgress.status && scanProgress.status !== 'complete' && (
            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-start gap-3">
                {scanProgress.status === 'error' ? (
                  <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                ) : scanProgress.status === 'complete' ? (
                  <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                ) : (
                  <RefreshCw className="w-5 h-5 animate-spin text-blue-600 mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1">
                  {scanProgress.currentCompany && (
                    <div className="font-semibold text-blue-900 mb-1">
                      {scanProgress.currentCompany}
                    </div>
                  )}
                  <div className="text-sm text-blue-800 mb-2">
                    {scanProgress.message}
                  </div>
                  {scanProgress.total > 0 && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs text-blue-700">
                        <span>Progress: {scanProgress.progress} / {scanProgress.total}</span>
                        <span>{scanProgress.percentage}%</span>
                      </div>
                      <div className="w-full bg-blue-200 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${scanProgress.percentage}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {scanProgress.casesFound > 0 && (
                    <div className="text-xs text-blue-700 mt-2">
                      Total cases found so far: {scanProgress.casesFound}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {scanProgress.status === 'complete' && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                <div className="text-sm text-green-800">
                  {scanProgress.message}
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-4 mb-4">
            <div className="flex gap-4 items-center flex-1">
              <div>
                <label className="text-sm text-gray-600 mr-2">Priority:</label>
                <select
                  value={filter.priority}
                  onChange={(e) => setFilter({ ...filter, priority: e.target.value })}
                  className="border border-gray-300 rounded px-3 py-2"
                >
                  <option value="all">All</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-600 mr-2">View:</label>
                <select
                  value={filter.view}
                  onChange={(e) => setFilter({ ...filter, view: e.target.value })}
                  className="border border-gray-300 rounded px-3 py-2"
                >
                  <option value="recent">Recent (7 days)</option>
                  <option value="all">All Cases</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 items-center">
              {lastScan && (
                <span className="text-sm text-gray-600">
                  Last scan: {formatDate(lastScan)}
                </span>
              )}
              <button
                onClick={triggerScan}
                disabled={scanning}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
              >
                <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
                {scanning ? 'Scanning...' : 'Run Full Scan'}
              </button>
            </div>
          </div>
          
          <div className="border-t pt-4">
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Search Specific Company
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchCompany}
                onChange={(e) => setSearchCompany(e.target.value)}
                placeholder="Enter company ID (e.g., 'epic-games', 'riot-games')"
                className="flex-1 border border-gray-300 rounded px-3 py-2"
                disabled={scanning}
              />
              <button
                onClick={searchSpecificCompany}
                disabled={scanning || !searchCompany}
                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:bg-gray-400"
              >
                Search Company
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Common IDs: epic-games, riot-games, activision-blizzard, ea, valve, nintendo, ubisoft, sony-interactive
            </p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">
              Lawsuit Tracker
            </h2>
          </div>
          
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : lawsuits.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No cases found. Try running a scan or adjusting filters.
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {lawsuits.map((lawsuit) => (
                <div key={lawsuit.id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-900">
                          {lawsuit.company_name}
                        </span>
                        <span className={`text-xs px-2 py-1 rounded border ${getPriorityColor(lawsuit.priority)}`}>
                          {lawsuit.priority?.toUpperCase()}
                        </span>
                      </div>
                      <h3 className="text-sm font-medium text-gray-800 mb-1">
                        {lawsuit.case_name}
                      </h3>
                      <div className="flex gap-4 text-xs text-gray-600 mb-2">
                        <span>Docket: {lawsuit.docket_number}</span>
                        <span>Filed: {formatDate(lawsuit.date_filed)}</span>
                        <span>Court: {lawsuit.court}</span>
                      </div>
                      {lawsuit.keywords && lawsuit.keywords.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {lawsuit.keywords.map((keyword, idx) => (
                            <span key={idx} className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded">
                              {keyword}
                            </span>
                          ))}
                        </div>
                      )}
                      {lawsuit.cause && (
                        <p className="text-sm text-gray-600 line-clamp-2">
                          {lawsuit.cause}
                        </p>
                      )}
                    </div>
                    <a
                      href={lawsuit.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-4 text-blue-600 hover:text-blue-800 text-sm whitespace-nowrap"
                    >
                      View Details →
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-8 text-center text-sm text-gray-500">
          <p>Data sources: CourtListener API</p>
          <p className="mt-1">More scanners coming soon: Trademarks, Job Postings, SEC Filings</p>
        </div>
      </div>
    </div>
  );
}