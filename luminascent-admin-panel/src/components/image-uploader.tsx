import { useRef, useState } from 'react'
import { ImagePlus, Loader2, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { ProductImageInput } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type UploadedImage = {
  id: string
  r2_key: string
  url: string
  is_primary: boolean
}

type ImageUploaderProps = {
  productId: string
  value: UploadedImage[]
  onChange: (images: UploadedImage[]) => void
}

export function ImageUploader({ productId, value, onChange }: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const toProductImageInputs = (images: UploadedImage[]): ProductImageInput[] =>
    images.map((image, index) => ({
      r2_key: image.r2_key,
      position: index,
      is_primary: image.is_primary,
    }))

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return

    setUploading(true)
    const nextImages = [...value]

    try {
      for (const file of Array.from(files)) {
        const uploaded = await api.products.uploadImage(productId, file)
        nextImages.push({
          id: uploaded.id,
          r2_key: uploaded.r2_key,
          url: uploaded.url,
          is_primary: nextImages.length === 0,
        })
      }

      onChange(nextImages)
      toast.success(nextImages.length === 1 ? 'Image uploaded' : 'Images uploaded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const handleRemove = async (image: UploadedImage) => {
    try {
      await api.products.deleteImage(productId, image.r2_key)
      const remaining = value.filter((item) => item.r2_key !== image.r2_key)
      if (image.is_primary && remaining.length > 0) {
        remaining[0] = { ...remaining[0], is_primary: true }
      }
      onChange(remaining)
      toast.success('Image removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove image')
    }
  }

  const handleSetPrimary = (r2Key: string) => {
    onChange(
      value.map((image) => ({
        ...image,
        is_primary: image.r2_key === r2Key,
      })),
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Product images</p>
          <p className="text-muted-foreground text-xs">
            Upload before saving. Images are stored under the draft product id.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />}
          Add images
        </Button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(event) => void handleFiles(event.target.files)}
      />

      {value.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {value.map((image) => (
            <div
              key={image.r2_key}
              className={cn(
                'group relative overflow-hidden rounded-lg border',
                image.is_primary && 'ring-primary ring-2',
              )}
            >
              <img
                src={image.url}
                alt=""
                className="aspect-square w-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/60 p-2">
                <Button
                  type="button"
                  size="icon-xs"
                  variant={image.is_primary ? 'default' : 'secondary'}
                  onClick={() => handleSetPrimary(image.r2_key)}
                  title="Set as primary"
                >
                  <Star className={cn(!image.is_primary && 'opacity-60')} />
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="destructive"
                  onClick={() => void handleRemove(image)}
                  title="Remove image"
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          No images uploaded yet
        </div>
      )}

      <input type="hidden" value={JSON.stringify(toProductImageInputs(value))} readOnly />
    </div>
  )
}

export function uploadedImagesToInputs(images: UploadedImage[]): ProductImageInput[] {
  return images.map((image, index) => ({
    r2_key: image.r2_key,
    position: index,
    is_primary: image.is_primary,
  }))
}
