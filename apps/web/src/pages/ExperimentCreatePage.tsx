import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  PlayCircle,
  ShieldCheck,
} from 'lucide-react';
import { useProfiles, useCreateProfile, useStartRun } from '../api/hooks';
import type { CreateProfileInput, Fault } from '../types/api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { useToast } from '../components/ui/Toast';

export const ExperimentCreatePage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const prefillProfileId = searchParams.get('profileId') || '';

  const { data: profilesData } = useProfiles();
  const profiles = profilesData?.items || [];

  const [mode, setMode] = useState<'profile' | 'custom'>(prefillProfileId ? 'profile' : 'custom');
  const [selectedProfileId, setSelectedProfileId] = useState(prefillProfileId);

  // Custom experiment form state
  const [name, setName] = useState('Dynamic Network Fault Run');
  const [description, setDescription] = useState('Experiment triggered from web dashboard');
  const [requestCount, setRequestCount] = useState(10);
  const [requestTimeoutMs, setRequestTimeoutMs] = useState(5000);

  // Target selection (strictly restricted to configured target)
  const [targetEndpoint, setTargetEndpoint] = useState('/api/demo');

  // Fault selection
  const [faultType, setFaultType] = useState<'latency' | 'timeout' | 'bandwidth' | 'reset'>('latency');
  const [stream, setStream] = useState<'downstream' | 'upstream'>('downstream');
  const [latencyMs, setLatencyMs] = useState(250);
  const [jitterMs, setJitterMs] = useState(20);
  const [timeoutMs, setTimeoutMs] = useState(2000);
  const [rateKbps, setRateKbps] = useState(250);

  const createProfile = useCreateProfile();
  const startRun = useStartRun();
  const { toast } = useToast();
  const navigate = useNavigate();

  const isSubmitting = createProfile.isPending || startRun.isPending;

  const buildFault = (): Fault => {
    if (faultType === 'latency') {
      return {
        type: 'latency',
        latencyMs: Number(latencyMs),
        jitterMs: Number(jitterMs) || 0,
        stream,
        toxicity: 1.0,
      };
    }
    if (faultType === 'timeout') {
      return {
        type: 'timeout',
        timeoutMs: Number(timeoutMs),
        stream,
        toxicity: 1.0,
      };
    }
    if (faultType === 'bandwidth') {
      return {
        type: 'bandwidth',
        rateKbps: Number(rateKbps),
        stream,
        toxicity: 1.0,
      };
    }
    return {
      type: 'reset',
      stream,
      toxicity: 1.0,
    };
  };

  const handleLaunch = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      let targetProfileId = selectedProfileId;

      if (mode === 'custom') {
        if (!name.trim()) {
          toast({ title: 'Validation Error', message: 'Experiment name is required.', type: 'error' });
          return;
        }

        const fault = buildFault();
        const profilePayload: CreateProfileInput = {
          name: name.trim(),
          description: description.trim() || undefined,
          engine: 'toxiproxy',
          target: {
            type: 'http',
            path: targetEndpoint,
            method: 'GET',
          },
          requestCount: Number(requestCount),
          requestTimeoutMs: Number(requestTimeoutMs),
          faults: [fault],
          tags: ['dashboard', faultType],
        };

        const created = await createProfile.mutateAsync(profilePayload);
        targetProfileId = created.id;
      }

      if (!targetProfileId) {
        toast({ title: 'Profile Required', message: 'Please select a profile to run.', type: 'error' });
        return;
      }

      const run = await startRun.mutateAsync(targetProfileId);
      toast({
        title: 'Experiment Started',
        message: `Run ${run.id.slice(0, 8)}... accepted by runner`,
        type: 'success',
      });
      navigate(`/runs/${run.id}`);
    } catch (err: any) {
      toast({
        title: 'Launch Failed',
        message: err.message || 'An error occurred while launching experiment',
        type: 'error',
      });
    }
  };

  const selectedProfileObj = profiles.find((p) => p.id === selectedProfileId);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
          <PlayCircle className="w-5 h-5 text-indigo-400" />
          Create and Launch Experiment
        </h2>
        <p className="text-xs text-zinc-400 mt-1">
          Specify network conditions, inspect pre-run preview, and trigger bounded execution.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form Inputs (2 cols) */}
        <div className="lg:col-span-2">
          <form onSubmit={handleLaunch} className="space-y-6">
            {/* Mode Selector */}
            <div className="p-1.5 bg-surface-raised border border-surface-border rounded-xl flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMode('custom')}
                className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
                  mode === 'custom'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Compose New Fault
              </button>
              <button
                type="button"
                onClick={() => setMode('profile')}
                className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
                  mode === 'profile'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Use Saved Profile
              </button>
            </div>

            {mode === 'profile' ? (
              <Card title="Select Profile" description="Pick an existing profile to run">
                <Select
                  label="Saved Profile"
                  value={selectedProfileId}
                  onChange={(e) => setSelectedProfileId(e.target.value)}
                  required
                >
                  <option value="">-- Choose a profile --</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.requestCount} reqs, {p.faults.map((f) => f.type).join(', ')})
                    </option>
                  ))}
                </Select>
              </Card>
            ) : (
              <div className="space-y-4">
                <Card title="Experiment Specifications" description="Name and test configuration">
                  <div className="space-y-4">
                    <Input
                      label="Experiment Name"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Edge Latency Spike Under High Load"
                    />

                    <Input
                      label="Description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />

                    <div className="grid grid-cols-2 gap-4">
                      <Input
                        label="Request Probes (1 - 100)"
                        type="number"
                        min={1}
                        max={100}
                        value={requestCount}
                        onChange={(e) => setRequestCount(Number(e.target.value))}
                      />
                      <Input
                        label="Request Timeout (ms)"
                        type="number"
                        min={100}
                        max={30000}
                        value={requestTimeoutMs}
                        onChange={(e) => setRequestTimeoutMs(Number(e.target.value))}
                      />
                    </div>

                    {/* Restricted Target Selection */}
                    <div>
                      <Select
                        label="Test Target Endpoint"
                        value={targetEndpoint}
                        onChange={(e) => setTargetEndpoint(e.target.value)}
                        helperText="Restricted strictly to the local Node.js test-target via Toxiproxy listener (127.0.0.1:8666)"
                      >
                        <option value="/api/demo">GET /api/demo (Default JSON probe)</option>
                        <option value="/api/slow">GET /api/slow (Simulated processing delay)</option>
                        <option value="/health">GET /health (Target health check)</option>
                      </Select>
                    </div>
                  </div>
                </Card>

                {/* Fault Details Card */}
                <Card title="Network Fault Parameters" description="Define the exact failure to inject">
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <Select
                        label="Fault Type"
                        value={faultType}
                        onChange={(e) => setFaultType(e.target.value as any)}
                      >
                        <option value="latency">Latency (Packet delay)</option>
                        <option value="timeout">Timeout (Connection stall)</option>
                        <option value="bandwidth">Bandwidth (Rate limit)</option>
                        <option value="reset">TCP Reset (Immediate RST)</option>
                      </Select>

                      <Select
                        label="Traffic Stream"
                        value={stream}
                        onChange={(e) => setStream(e.target.value as any)}
                        helperText="Direction to apply the fault"
                      >
                        <option value="downstream">Downstream (Target → Client)</option>
                        <option value="upstream">Upstream (Client → Target)</option>
                      </Select>
                    </div>

                    {faultType === 'latency' && (
                      <div className="grid grid-cols-2 gap-4 animate-in fade-in">
                        <Input
                          label="Added Delay (ms)"
                          type="number"
                          min={0}
                          max={60000}
                          value={latencyMs}
                          onChange={(e) => setLatencyMs(Number(e.target.value))}
                          helperText="Exact delay injected into TCP stream"
                        />
                        <Input
                          label="Jitter (± ms)"
                          type="number"
                          min={0}
                          max={30000}
                          value={jitterMs}
                          onChange={(e) => setJitterMs(Number(e.target.value))}
                          helperText="Randomized delay variance"
                        />
                      </div>
                    )}

                    {faultType === 'timeout' && (
                      <div className="animate-in fade-in">
                        <Input
                          label="Timeout Delay (ms)"
                          type="number"
                          min={0}
                          max={60000}
                          value={timeoutMs}
                          onChange={(e) => setTimeoutMs(Number(e.target.value))}
                          helperText="0 stalls indefinitely until removed"
                        />
                      </div>
                    )}

                    {faultType === 'bandwidth' && (
                      <div className="animate-in fade-in">
                        <Input
                          label="Rate Limit (KB/s)"
                          type="number"
                          min={1}
                          max={1000000}
                          value={rateKbps}
                          onChange={(e) => setRateKbps(Number(e.target.value))}
                          helperText="Throttles connection bandwidth"
                        />
                      </div>
                    )}
                  </div>
                </Card>
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              isLoading={isSubmitting}
              icon={<PlayCircle className="w-5 h-5" />}
            >
              Start Experiment Run
            </Button>
          </form>
        </div>

        {/* Pre-Run Summary Card (1 col) */}
        <div className="space-y-4">
          <Card
            title="Pre-Run Summary"
            description="Verified configuration before execution"
            className="border-indigo-500/30 bg-surface-raised/90 sticky top-24"
          >
            <div className="space-y-3 text-xs">
              <div className="flex items-center gap-2 text-emerald-400 font-medium">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Target Whitelist Validated</span>
              </div>

              <div className="p-3 bg-surface rounded-lg border border-surface-border space-y-2">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Target URL:</span>
                  <span className="font-mono text-zinc-200">
                    http://127.0.0.1:8666{mode === 'custom' ? targetEndpoint : selectedProfileObj?.target.path || '/api/demo'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Probes:</span>
                  <span className="font-mono text-zinc-200">
                    {mode === 'custom' ? requestCount : selectedProfileObj?.requestCount || '—'} requests
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Timeout:</span>
                  <span className="font-mono text-zinc-200">
                    {mode === 'custom' ? requestTimeoutMs : selectedProfileObj?.requestTimeoutMs || '—'} ms
                  </span>
                </div>
              </div>

              <div className="p-3 bg-surface rounded-lg border border-surface-border space-y-1.5">
                <span className="text-zinc-400 font-semibold block">Fault Blueprint:</span>
                {mode === 'custom' ? (
                  <p className="font-mono text-indigo-300 font-medium">
                    {faultType === 'latency' && `+${latencyMs}ms delay (jitter ±${jitterMs}ms, ${stream})`}
                    {faultType === 'timeout' && `TCP stall ${timeoutMs}ms (${stream})`}
                    {faultType === 'bandwidth' && `Throttled to ${rateKbps} KB/s (${stream})`}
                    {faultType === 'reset' && `Immediate TCP RST segment (${stream})`}
                  </p>
                ) : (
                  <p className="font-mono text-indigo-300 font-medium">
                    {selectedProfileObj
                      ? selectedProfileObj.faults.map((f) => f.type).join(', ')
                      : 'None selected'}
                  </p>
                )}
              </div>

              <div className="p-3 bg-indigo-950/30 border border-indigo-800/40 rounded-lg text-indigo-200 text-[11px] leading-relaxed">
                <strong>Execution Guarantee:</strong> Injected faults are removed automatically in a <code>finally</code> block immediately upon completion or cancellation. No lingering toxics persist.
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};
