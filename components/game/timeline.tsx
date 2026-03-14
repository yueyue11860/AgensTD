'use client'

import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { ReplaySnapshot } from '@/lib/mock-data'
import { Play, Pause, SkipBack, SkipForward, FastForward } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface TimelineProps {
  snapshots: ReplaySnapshot[]
  currentTick: number
  maxTicks: number
  onSeek?: (tick: number) => void
  className?: string
}

export function Timeline({
  snapshots,
  currentTick,
  maxTicks,
  onSeek,
  className,
}: TimelineProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)

  const progress = (currentTick / maxTicks) * 100

  const markers = useMemo(() => {
    return snapshots.map((snapshot) => ({
      tick: snapshot.tick,
      position: (snapshot.tick / maxTicks) * 100,
      wave: snapshot.game_state.wave,
    }))
  }, [snapshots, maxTicks])

  const formatTick = (tick: number): string => {
    const seconds = Math.floor(tick / 60)
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
  }

  return (
    <div className={cn('rounded-lg border border-border bg-card p-4', className)}>
      {/* Controls */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onSeek?.(0)}
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            variant="default"
            size="icon"
            className="h-10 w-10"
            onClick={() => setIsPlaying(!isPlaying)}
          >
            {isPlaying ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5 ml-0.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onSeek?.(maxTicks)}
          >
            <SkipForward className="h-4 w-4" />
          </Button>
          <div className="mx-2 h-6 w-px bg-border" />
          <Button
            variant={playbackSpeed === 1 ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setPlaybackSpeed(1)}
          >
            1x
          </Button>
          <Button
            variant={playbackSpeed === 2 ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setPlaybackSpeed(2)}
          >
            2x
          </Button>
          <Button
            variant={playbackSpeed === 4 ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setPlaybackSpeed(4)}
          >
            <FastForward className="h-3 w-3" />
            4x
          </Button>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">TICK</span>
            <span className="font-mono text-foreground">{currentTick.toLocaleString()}</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <span className="font-mono text-muted-foreground">
            {formatTick(currentTick)} / {formatTick(maxTicks)}
          </span>
        </div>
      </div>

      {/* Timeline Track */}
      <div className="relative">
        {/* Progress Bar */}
        <div className="relative h-2 rounded-full bg-muted">
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
          
          {/* Snapshot Markers */}
          {markers.map((marker, index) => (
            <button
              key={index}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-4 w-1 rounded-sm bg-warning-orange/70 hover:bg-warning-orange transition-colors"
              style={{ left: `${marker.position}%` }}
              onClick={() => onSeek?.(marker.tick)}
              title={`Wave ${marker.wave} - Tick ${marker.tick}`}
            />
          ))}
          
          {/* Current Position Handle */}
          <div
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-4 w-4 rounded-full border-2 border-primary bg-background shadow-lg cursor-grab"
            style={{ left: `${progress}%` }}
          />
        </div>

        {/* Wave Labels */}
        <div className="mt-3 flex justify-between text-[10px] text-muted-foreground">
          <span>WAVE 0</span>
          {markers.filter((_, i) => i % 2 === 1).map((marker, index) => (
            <span
              key={index}
              className="absolute -translate-x-1/2"
              style={{ left: `${marker.position}%` }}
            >
              W{marker.wave}
            </span>
          ))}
          <span>WAVE 50</span>
        </div>
      </div>
    </div>
  )
}

// Mini Timeline for Cards - Enhanced with tick marks
interface MiniTimelineProps {
  currentTick: number
  maxTicks: number
  className?: string
}

export function MiniTimeline({ currentTick, maxTicks, className }: MiniTimelineProps) {
  const progress = (currentTick / maxTicks) * 100

  return (
    <div className={cn('space-y-1.5', className)}>
      {/* Timeline with tick marks */}
      <div className="relative">
        {/* Tick scale marks */}
        <div className="absolute -top-1 left-0 right-0 flex justify-between">
          {[0, 25, 50, 75, 100].map((mark) => (
            <div
              key={mark}
              className="h-1 w-px bg-border"
            />
          ))}
        </div>
        
        {/* Progress track */}
        <div className="h-1.5 overflow-hidden rounded-sm bg-muted/50 border border-border/50">
          <div
            className="h-full bg-gradient-to-r from-primary/80 to-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        
        {/* Current position marker */}
        <div 
          className="absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_4px_rgba(101,144,247,0.5)]"
          style={{ left: `${progress}%` }}
        />
      </div>
      
      {/* Labels */}
      <div className="flex justify-between font-mono text-[9px]">
        <span className="text-muted-foreground">T:{currentTick.toLocaleString()}</span>
        <span className="text-primary">{Math.round(progress)}%</span>
      </div>
    </div>
  )
}
