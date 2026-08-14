import Image from "next/image";

type ScreenshotProps = {
  src: string;
  alt: string;
  width: number;
  height: number;
  priority?: boolean;
  className?: string;
};

export function DeviceFrameMobile({ src, alt, width, height, priority = false, className = "" }: ScreenshotProps) {
  return (
    <figure className={`device-mobile ${className}`}>
      <span className="device-mobile-speaker" aria-hidden="true" />
      <div className="device-mobile-screen">
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          sizes="(max-width: 767px) 72vw, 24rem"
        />
      </div>
    </figure>
  );
}

export function DeviceFrameDesktop({ src, alt, width, height, priority = false, className = "" }: ScreenshotProps) {
  return (
    <figure className={`device-desktop ${className}`}>
      <div className="device-desktop-bar" aria-hidden="true">
        <span /><span /><span />
      </div>
      <div className="device-desktop-screen">
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          sizes="(max-width: 767px) 94vw, (max-width: 1199px) 70vw, 48rem"
        />
      </div>
      <span className="device-desktop-base" aria-hidden="true" />
    </figure>
  );
}
