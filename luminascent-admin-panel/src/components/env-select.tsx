import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useEnv } from '@/context/env-context'

export function EnvSelect() {
  const { environment, environments, setEnvironmentId } = useEnv()

  return (
    <Select
      value={environment.id}
      onValueChange={(value) => {
        if (value) setEnvironmentId(value)
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Environment" />
      </SelectTrigger>
      <SelectContent>
        {environments.map((env) => (
          <SelectItem key={env.id} value={env.id}>
            {env.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
