import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionsAPI, messagesAPI, toolCallsAPI, eventsAPI, assetsAPI, statsAPI, systemAPI } from '../services/api';

// Sessions hooks
export const useSessions = (params?: { page?: number; page_size?: number }) => {
  return useQuery({
    queryKey: ['sessions', params],
    queryFn: () => sessionsAPI.list(params).then(res => res.data),
  });
};

export const useSession = (sessionId: string) => {
  return useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => sessionsAPI.get(sessionId).then(res => res.data),
    enabled: !!sessionId,
  });
};

export const useSessionMessages = (sessionId: string, params?: { page?: number; page_size?: number }) => {
  return useQuery({
    queryKey: ['session-messages', sessionId, params],
    queryFn: () => sessionsAPI.getMessages(sessionId, params).then(res => res.data),
    enabled: !!sessionId,
  });
};

export const useSessionToolCalls = (sessionId: string, params?: { page?: number; page_size?: number }) => {
  return useQuery({
    queryKey: ['session-tool-calls', sessionId, params],
    queryFn: () => sessionsAPI.getToolCalls(sessionId, params).then(res => res.data),
    enabled: !!sessionId,
  });
};

// Messages hooks
export const useMessages = (params?: { session_id?: string; role?: string; page?: number; page_size?: number }) => {
  return useQuery({
    queryKey: ['messages', params],
    queryFn: () => messagesAPI.list(params).then(res => res.data),
  });
};

export const useMessage = (messageId: string) => {
  return useQuery({
    queryKey: ['message', messageId],
    queryFn: () => messagesAPI.get(messageId).then(res => res.data),
    enabled: !!messageId,
  });
};

// Tool Calls hooks
export const useToolCalls = (params?: { session_id?: string; tool_name?: string; page?: number; page_size?: number }) => {
  return useQuery({
    queryKey: ['tool-calls', params],
    queryFn: () => toolCallsAPI.list(params).then(res => res.data),
  });
};

export const useToolCall = (toolCallId: string) => {
  return useQuery({
    queryKey: ['tool-call', toolCallId],
    queryFn: () => toolCallsAPI.get(toolCallId).then(res => res.data),
    enabled: !!toolCallId,
  });
};

// Events hooks
export const useEvents = (params?: { session_id?: string; page?: number; page_size?: number }) => {
  return useQuery({
    queryKey: ['events', params],
    queryFn: () => eventsAPI.list(params).then(res => res.data),
  });
};

export const useEvent = (eventId: string) => {
  return useQuery({
    queryKey: ['event', eventId],
    queryFn: () => eventsAPI.get(eventId).then(res => res.data),
    enabled: !!eventId,
  });
};

export const useEventsOverview = () => {
  return useQuery({
    queryKey: ['events-overview'],
    queryFn: () => eventsAPI.overview().then(res => res.data),
  });
};

// Assets hooks
export const useAssessPath = (path: string) => {
  return useQuery({
    queryKey: ['assess-path', path],
    queryFn: () => assetsAPI.assessPath(path).then(res => res.data),
    enabled: !!path,
  });
};

export const useHardwareInfo = () => {
  return useQuery({
    queryKey: ['hardware-info'],
    queryFn: () => assetsAPI.hardware().then(res => res.data),
  });
};

export const useRuntimeInstances = (enabled = true) => {
  return useQuery({
    queryKey: ['runtime-instances'],
    queryFn: () => systemAPI.instances().then(res => res.data),
    enabled,
    staleTime: 5000,
    refetchInterval: enabled ? 5000 : false,
    placeholderData: previousData => previousData,
  });
};

export const useAssetScan = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { path?: string; max_depth?: number; scan_system_root?: boolean }) =>
      assetsAPI.startScan(data).then((res: any) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets-overview'] });
    },
  });
};

export const useAssetsOverview = () => {
  return useQuery({
    queryKey: ['assets-overview'],
    queryFn: () => assetsAPI.overview().then(res => res.data),
  });
};

// Statistics hooks
export const useStatistics = () => {
  return useQuery({
    queryKey: ['statistics'],
    queryFn: () => statsAPI.overview().then(res => res.data),
  });
};

export const useToolUsage = () => {
  return useQuery({
    queryKey: ['tool-usage'],
    queryFn: () => statsAPI.toolUsage().then(res => res.data),
  });
};
