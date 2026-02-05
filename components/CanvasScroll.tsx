
"use client"
import { useRef, useEffect, useState, useCallback } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Projects from "../components/Projects";

if (typeof window !== "undefined") {
    gsap.registerPlugin(ScrollTrigger);
}

// Monochrome CRT Shader - white tones only
const crtVertexShader = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vWorldPosition;

void main() {
    vUv = uv;
    vNormal = normal;
    vPosition = position;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    
    vec3 pos = position;
    if (abs(normal.z) > 0.9) {
        float curveAmount = 0.08;
        float distanceFromCenter = length(uv - 0.5);
        pos.z += sin(distanceFromCenter * 3.14159) * curveAmount * 0.08;
    }
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const crtFragmentShader = `
uniform sampler2D videoTexture;
uniform float time;
uniform float emissiveIntensity;
uniform vec2 resolution;
uniform float curvature;
uniform float vignetteIntensity;
uniform float scanlineIntensity;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;

// Monochrome scanlines
float getScanlines(vec2 uv, float time) {
    float scanline = sin(uv.y * resolution.y * 3.14159 * 0.45) * 0.5 + 0.5;
    scanline = pow(scanline, 12.0);
    
    float motion = sin(time * 0.3 + uv.y * 8.0) * 0.001;
    float scanline2 = sin((uv.y + motion) * resolution.y * 3.14159 * 0.65) * 0.5 + 0.5;
    scanline2 = pow(scanline2, 10.0);
    
    return mix(scanline, scanline2, 0.2);
}

vec2 barrelDistortion(vec2 uv, float amount) {
    vec2 centered = uv - 0.5;
    float distance = dot(centered, centered);
    vec2 distorted = centered * (1.0 + amount * distance * distance * 0.8);
    return distorted + 0.5;
}

void main() {
    vec2 distortedUv = barrelDistortion(vUv, curvature * 0.7);
    
    if (distortedUv.x < 0.0 || distortedUv.x > 1.0 || distortedUv.y < 0.0 || distortedUv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    
    float horizontalHold = sin(time * 0.2 + distortedUv.y * 4.0) * 0.00005;
    vec4 videoColor = texture2D(videoTexture, vec2(distortedUv.x + horizontalHold, distortedUv.y));
    
    // Convert to monochrome white tones
    float gray = dot(videoColor.rgb, vec3(0.299, 0.587, 0.114));
    vec3 monochrome = vec3(gray * 0.95, gray * 0.95, gray * 0.95);
    
    // Apply scanlines in white tones
    float scanlines = getScanlines(distortedUv, time);
    monochrome *= mix(1.0, 0.85 + 0.15 * scanlines, scanlineIntensity * 0.7);
    
    // Soft vignette
    float dist = distance(distortedUv, vec2(0.5, 0.5));
    float vignette = 1.0 - dist * vignetteIntensity * 0.9;
    vignette = smoothstep(0.0, 1.0, vignette);
    monochrome *= vignette;
    
    // White emissive bloom
    monochrome += monochrome * emissiveIntensity * (0.3 + 0.2 * sin(time * 1.5)) * 0.15;
    
    // Monochrome noise
    float noise = fract(sin(dot(distortedUv + time * 0.05, vec2(12.9898, 78.233))) * 43758.5453) * 0.01;
    monochrome += noise;
    
    gl_FragColor = vec4(monochrome, 1.0);
}
`;

// White-only materials
const createWhiteMaterial = (brightness: number, roughness: number, textureScale = 12) => {
    const whiteValue = Math.floor(brightness * 255);
    const color = (whiteValue << 16) | (whiteValue << 8) | whiteValue;

    const material = new THREE.MeshPhysicalMaterial({
        color: color,
        metalness: 0.1,
        roughness: roughness,
        clearcoat: 0.5,
        clearcoatRoughness: 0.05,
        reflectivity: 0.2,
        sheen: 0.1,
    });

    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1024, 1024);

    ctx.globalAlpha = 0.015;
    for (let i = 0; i < 20000; i++) {
        const x = Math.random() * 1024;
        const y = Math.random() * 1024;
        ctx.fillRect(x, y, 1, 1);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(textureScale, textureScale);
    material.map = texture;

    return material;
};



export default function InteractiveOldPC() {
    const containerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const screenMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
    const isScrollingRef = useRef(false);
    const videoPlaybackRequestedRef = useRef(false);
    const fullscreenVideoTriggeredRef = useRef(false);
    const [darkMode, setDarkMode] = useState(false);
    const buttonRef = useRef<THREE.Mesh>(null);
    const arrowRef = useRef<THREE.Group>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

    const createVideoElement = useCallback(() => {
        const video = document.createElement("video");
        video.src = "/video.mp4";
        video.loop = false;
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        video.crossOrigin = "anonymous";

        video.onerror = () => {
            console.warn("Video failed to load, using fallback texture");
        };

        return video;
    }, []);

    const initializeVideoPlayback = useCallback(async (video: HTMLVideoElement) => {
        try {
            await new Promise(resolve => setTimeout(resolve, 300));
            const playPromise = video.play();
            if (playPromise !== undefined) {
                await playPromise;
                videoPlaybackRequestedRef.current = true;
            }
        } catch (err) {
            console.warn("Autoplay failed:", err);
        }
    }, []);

    const resumeVideoOnInteraction = useCallback(() => {
        if (videoRef.current && !videoPlaybackRequestedRef.current) {
            videoRef.current.play().catch(() => { });
            videoPlaybackRequestedRef.current = true;
        }
    }, []);

    const handleFullscreenVideo = useCallback(() => {
        if (fullscreenVideoTriggeredRef.current) return;
        fullscreenVideoTriggeredRef.current = true;
    }, []);

    const toggleDarkMode = useCallback(() => {
        setDarkMode(prev => !prev);
        // Apply dark mode to the page
        if (darkMode) {
            document.body.classList.remove('dark-mode');
        } else {
            document.body.classList.add('dark-mode');
        }
    }, [darkMode]);

    const handleButtonClick = useCallback((event: MouseEvent) => {
        if (!buttonRef.current || !cameraRef.current) return;

        const mouse = new THREE.Vector2();
        const raycaster = new THREE.Raycaster();
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        raycaster.setFromCamera(mouse, cameraRef.current);
        const intersects = raycaster.intersectObject(buttonRef.current, true);

        if (intersects.length > 0) {
            toggleDarkMode();

            // Button click animation
            gsap.to(buttonRef.current.scale, {
                x: 0.9,
                y: 0.9,
                z: 0.9,
                duration: 0.1,
                yoyo: true,
                repeat: 1
            });

            // Hide arrow after click
            if (arrowRef.current) {
                gsap.to(arrowRef.current.position, {
                    y: arrowRef.current.position.y - 0.2,
                    opacity: 0,
                    duration: 0.5,
                    onComplete: () => {
                        arrowRef.current!.visible = false;
                    }
                });
            }
        }
    }, [toggleDarkMode]);

    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        document.addEventListener("click", resumeVideoOnInteraction);
        document.addEventListener("touchstart", resumeVideoOnInteraction);
        document.addEventListener("keydown", resumeVideoOnInteraction);
        document.addEventListener("click", handleButtonClick);

        /* -------------------- Scene Setup -------------------- */
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(darkMode ? 0x0a0a0a : 0xf5f5f5);

        /* -------------------- Camera -------------------- */
        const camera = new THREE.PerspectiveCamera(
            45,
            window.innerWidth / window.innerHeight,
            0.1,
            100
        );
        camera.position.set(0, 0.3, 3);
        cameraRef.current = camera;

        /* -------------------- Renderer -------------------- */
        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: "high-performance",
            precision: "highp"
        });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        container.appendChild(renderer.domElement);

        /* -------------------- Monochrome Lighting -------------------- */
        const ambientLight = new THREE.AmbientLight(0xffffff, darkMode ? 0.2 : 0.4);
        scene.add(ambientLight);

        const mainLight = new THREE.DirectionalLight(0xffffff, darkMode ? 0.8 : 1.2);
        mainLight.position.set(3, 5, 2);
        mainLight.castShadow = true;
        mainLight.shadow.mapSize.width = 4096;
        mainLight.shadow.mapSize.height = 4096;
        mainLight.shadow.camera.near = 0.5;
        mainLight.shadow.camera.far = 10;
        mainLight.shadow.camera.left = -6;
        mainLight.shadow.camera.right = 6;
        mainLight.shadow.camera.top = 6;
        mainLight.shadow.camera.bottom = -6;
        mainLight.shadow.bias = -0.00005;
        scene.add(mainLight);

        const fillLight = new THREE.DirectionalLight(0xffffff, darkMode ? 0.15 : 0.25);
        fillLight.position.set(-3, 2, -2);
        scene.add(fillLight);

        const rimLight = new THREE.DirectionalLight(0xffffff, darkMode ? 0.1 : 0.15);
        rimLight.position.set(-2, 3, -3);
        scene.add(rimLight);

        const accentLight = new THREE.PointLight(0xffffff, darkMode ? 0.2 : 0.3, 10);
        accentLight.position.set(1, 1, 1);
        scene.add(accentLight);

        /* -------------------- Monitor Body -------------------- */
        const monitorWidth = 0.65;
        const monitorHeight = 0.55;
        const monitorDepth = 0.4;

        const monitorMesh = new THREE.Mesh(
            new RoundedBoxGeometry(
                monitorWidth,
                monitorHeight,
                monitorDepth,
                32,
                0.06
            ),
            createWhiteMaterial(0.95, 0.85, 10)
        );
        monitorMesh.position.y = 0;
        monitorMesh.castShadow = true;
        monitorMesh.receiveShadow = true;
        scene.add(monitorMesh);

        /* -------------------- Bezel -------------------- */
        const bezelGeometry = new THREE.BoxGeometry(
            monitorWidth - 0.05,
            monitorHeight - 0.18,
            0.001
        );
        const bezelMaterial = createWhiteMaterial(0.85, 0.6);
        bezelMaterial.clearcoat = 0.2;
        const bezel = new THREE.Mesh(bezelGeometry, bezelMaterial);
        bezel.position.z = monitorDepth / 2 + 0.018;
        monitorMesh.add(bezel);

        /* -------------------- CRT Screen -------------------- */
        const screenWidth = monitorWidth - 0.12;
        const screenHeight = monitorHeight - 0.25;
        const screenGeometry = new THREE.PlaneGeometry(screenWidth, screenHeight, 128, 128);

        const positions = screenGeometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const normalizedX = (x + screenWidth / 2) / screenWidth;
            const normalizedY = (y + screenHeight / 2) / screenHeight;
            const distanceFromCenter = Math.sqrt(
                Math.pow(normalizedX - 0.5, 2) +
                Math.pow(normalizedY - 0.5, 2)
            );
            const curveAmount = 0.015;
            positions.setZ(i, Math.sin(distanceFromCenter * Math.PI) * curveAmount * 1.5);
        }
        screenGeometry.computeVertexNormals();

        const video = createVideoElement();
        videoRef.current = video;
        const videoTexture = new THREE.VideoTexture(video);
        videoTexture.colorSpace = THREE.SRGBColorSpace;
        videoTexture.minFilter = THREE.LinearFilter;
        videoTexture.magFilter = THREE.LinearFilter;

        const screenMaterial = new THREE.ShaderMaterial({
            uniforms: {
                videoTexture: { value: videoTexture },
                time: { value: 0 },
                emissiveIntensity: { value: 0.05 },
                resolution: { value: new THREE.Vector2(1200, 800) },
                curvature: { value: 0.25 },
                vignetteIntensity: { value: 0.6 },
                scanlineIntensity: { value: 0.4 }
            },
            vertexShader: crtVertexShader,
            fragmentShader: crtFragmentShader,
            transparent: false,
            side: THREE.FrontSide
        });

        screenMaterialRef.current = screenMaterial;

        const screen = new THREE.Mesh(screenGeometry, screenMaterial);
        screen.position.z = monitorDepth / 2 + 0.022;
        monitorMesh.add(screen);

        /* -------------------- DARK MODE BUTTON -------------------- */
        const buttonGeometry = new THREE.CylinderGeometry(0.009, 0.009, 0.012, 16);
        const buttonMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 0.3,
            roughness: 0.4
        });

        const button = new THREE.Mesh(buttonGeometry, buttonMaterial);
        button.rotation.x = Math.PI / 2;
        button.position.set(
            -monitorWidth / 2 + 0.05,
            -monitorHeight / 2 + 0.05,
            monitorDepth / 2 + 0.008
        );
        buttonRef.current = button;
        monitorMesh.add(button);

        // Button hover effect
        button.userData.isHovered = false;


        /* -------------------- LED Indicator -------------------- */
        const ledGeometry = new THREE.CylinderGeometry(0.004, 0.004, 0.008, 20);
        const ledMaterial = new THREE.MeshStandardMaterial({
            color: darkMode ? 0x666666 : 0xffffff,
            emissive: darkMode ? 0x222222 : 0xffffff,
            emissiveIntensity: 0.2
        });
        const led = new THREE.Mesh(ledGeometry, ledMaterial);
        led.position.set(-monitorWidth / 2 + 0.09, -monitorHeight / 2 + 0.19, monitorDepth / 2 + 0.008);
        monitorMesh.add(led);

        /* -------------------- Desk -------------------- */
        const deskWidth = 7;
        const deskDepth = 3;
        const deskThickness = 0.4;

        const deskGeometry = new RoundedBoxGeometry(
            deskWidth,
            deskThickness,
            deskDepth,
            32,
            0.08
        );

        const deskMaterial = createWhiteMaterial(0.92, 0.85, 5);
        const desk = new THREE.Mesh(deskGeometry, deskMaterial);
        desk.position.set(0, -0.50, 0);
        desk.receiveShadow = true;
        scene.add(desk);

        /* -------------------- Screen Glow Effect -------------------- */
        const screenGlowGeometry = new THREE.PlaneGeometry(screenWidth + 0.012, screenHeight + 0.015);
        const screenGlowMaterial = new THREE.ShaderMaterial({
            uniforms: {
                baseColor: { value: new THREE.Color(0xffffff) },
                intensity: { value: 0.05 },
                time: { value: 0 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 baseColor;
                uniform float intensity;
                uniform float time;
                varying vec2 vUv;
                
                void main() {
                    float dist = distance(vUv, vec2(0.5, 0.5));
                    float pulse = sin(time * 1.2) * 0.5 + 0.5;
                    float glow = (1.0 - dist * 2.0) * intensity * (0.9 + 0.1 * pulse);
                    gl_FragColor = vec4(baseColor, glow * 0.2);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
        });
        const screenGlow = new THREE.Mesh(screenGlowGeometry, screenGlowMaterial);
        screenGlow.position.z = monitorDepth / 2 + 0.02;
        monitorMesh.add(screenGlow);

        /* -------------------- Scroll Animation -------------------- */
        const screenEmissiveIntensity = { value: 0.05 };

        const tl = gsap.timeline({
            scrollTrigger: {
                trigger: document.body,
                start: "top top",
                end: "+=250%",
                scrub: 2.0,
                pin: container,
                pinSpacing: false,
                onEnter: () => {
                    isScrollingRef.current = true;
                    if (videoRef.current && videoRef.current.paused) {
                        videoRef.current.play().catch(() => { });
                    }
                },
                onLeaveBack: () => {
                    isScrollingRef.current = false;
                },
                onUpdate: (self) => {
                    if (self.progress >= 0.999 && !fullscreenVideoTriggeredRef.current) {
                        handleFullscreenVideo();
                    }
                },
                onEnterBack: () => { },
            },
        });

        tl.to(camera.position, {
            z: 1.1,
            y: 0.15,
            ease: "power3.out"
        }, 0)
            .to(camera, {
                fov: 22,
                onUpdate: () => camera.updateProjectionMatrix(),
                ease: "power3.out"
            }, 0)
            .to(monitorMesh.rotation, {
                y: Math.PI * 0.15,
                x: -0.03,
                ease: "power3.out"
            }, 0)
            .to(screenEmissiveIntensity, {
                value: 0.25,
                ease: "power2.inOut"
            }, 0)
            .to(screenGlowMaterial.uniforms.intensity, {
                value: 0.1,
                ease: "power2.inOut"
            }, 0);

        /* -------------------- Mouse Interaction -------------------- */
        let mouseX = 0;
        let mouseY = 0;
        let targetRotationX = 0;
        let targetRotationY = 0;
        let currentRotationX = 0;
        let currentRotationY = 0;

        const onMouseMove = (e: MouseEvent) => {
            mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
            mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
            targetRotationY = mouseX * 0.12;
            targetRotationX = -mouseY * 0.08;

            // Button hover detection
            if (buttonRef.current) {
                const mouse = new THREE.Vector2(
                    (e.clientX / window.innerWidth) * 2 - 1,
                    -(e.clientY / window.innerHeight) * 2 + 1
                );
                const raycaster = new THREE.Raycaster();
                raycaster.setFromCamera(mouse, camera);
                const intersects = raycaster.intersectObject(buttonRef.current, true);

                if (intersects.length > 0 && !button.userData.isHovered) {
                    button.userData.isHovered = true;
                    gsap.to(button.scale, {
                        x: 1.1,
                        y: 1.1,
                        z: 1.1,
                        duration: 0.2
                    });
                } else if (intersects.length === 0 && button.userData.isHovered) {
                    button.userData.isHovered = false;
                    gsap.to(button.scale, {
                        x: 1,
                        y: 1,
                        z: 1,
                        duration: 0.2
                    });
                }
            }
        };
        window.addEventListener("mousemove", onMouseMove);

        /* -------------------- Resize Handler -------------------- */
        const onResize = () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
            ScrollTrigger.refresh();
        };
        window.addEventListener("resize", onResize);

        initializeVideoPlayback(video);

        /* -------------------- Animation Loop -------------------- */
        const clock = new THREE.Clock();
        let animationId: number;

        const animate = () => {
            animationId = requestAnimationFrame(animate);

            const delta = clock.getDelta();
            const time = clock.getElapsedTime();

            currentRotationY += (targetRotationY - currentRotationY) * 0.03;
            currentRotationX += (targetRotationX - currentRotationX) * 0.03;

            monitorMesh.rotation.y = currentRotationY;
            monitorMesh.rotation.x = currentRotationX;

            const idleWobble = Math.sin(time * 0.2) * 0.001;
            const idleBreath = Math.sin(time * 0.3) * 0.0005;
            monitorMesh.position.y = idleBreath;
            monitorMesh.rotation.z = idleWobble;

            const ledPulse = 0.2 + Math.sin(time * 1.5) * 0.15;
            ledMaterial.emissiveIntensity = ledPulse;

            // Update LED based on dark mode
            ledMaterial.color.setHex(darkMode ? 0x666666 : 0xffffff);
            ledMaterial.emissive.setHex(darkMode ? 0x222222 : 0xffffff);

            // Animate arrow
            // arrowAnimation();

            if (screenMaterialRef.current) {
                screenMaterialRef.current.uniforms.time.value = time;
                screenMaterialRef.current.uniforms.emissiveIntensity.value = screenEmissiveIntensity.value;
            }

            if (screenGlowMaterial.uniforms) {
                screenGlowMaterial.uniforms.time.value = time;
                screenGlowMaterial.uniforms.intensity.value = screenEmissiveIntensity.value * 0.3;
            }

            camera.lookAt(monitorMesh.position);
            renderer.render(scene, camera);
        };
        animate();

        /* -------------------- Cleanup -------------------- */
        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("resize", onResize);
            document.removeEventListener("click", resumeVideoOnInteraction);
            document.removeEventListener("touchstart", resumeVideoOnInteraction);
            document.removeEventListener("keydown", resumeVideoOnInteraction);
            document.removeEventListener("click", handleButtonClick);

            if (videoRef.current) {
                videoRef.current.pause();
                videoRef.current.src = "";
                videoRef.current.load();
            }

            cancelAnimationFrame(animationId);
            renderer.dispose();

            ScrollTrigger.getAll().forEach(trigger => trigger.kill());

            if (container.contains(renderer.domElement)) {
                container.removeChild(renderer.domElement);
            }

            cameraRef.current = null;
        };
    }, [createVideoElement, initializeVideoPlayback, resumeVideoOnInteraction, handleFullscreenVideo, darkMode, handleButtonClick]);

    return (
        <div className={`relative w-full min-h-screen transition-colors duration-500 ${darkMode ? 'bg-gradient-to-b from-gray-900 to-black' : 'bg-gradient-to-b from-gray-100 to-gray-300'
            }`}>
            {/* Dark mode indicator text */}
            <div className="fixed top-8 left-8 z-30">
                <div className={`backdrop-blur-md px-4 py-2 rounded-lg border ${darkMode ? 'bg-black/30 border-gray-700' : 'bg-white/30 border-gray-300'
                    }`}>
                    <span className={`text-sm font-mono ${darkMode ? 'text-gray-300' : 'text-gray-700'
                        }`}>
                        {darkMode ? 'DARK MODE ACTIVE' : 'LIGHT MODE ACTIVE'}
                    </span>
                </div>
            </div>

            {/* Button hint overlay */}
            <div className={`fixed top-1/2 left-4 z-30 transform -translate-y-1/2 transition-opacity duration-500 ${arrowRef.current?.visible === false ? 'opacity-0' : 'opacity-100'
                }`}>
                <div className={`backdrop-blur-xl px-4 py-3 rounded-r-xl border-l-4 ${darkMode
                    ? 'bg-black/40 border-gray-600'
                    : 'bg-white/40 border-gray-400'
                    }`}>
                    <div className="flex items-center space-x-3">
                        <div className={`animate-bounce ${darkMode ? 'text-gray-300' : 'text-gray-700'
                            }`}>
                            →
                        </div>
                        <div>
                            <p className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-800'
                                }`}>
                                Click white button
                            </p>
                            <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'
                                }`}>
                                Switch to {darkMode ? 'light' : 'dark'} mode
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Scroll space */}
            <div className="h-[250vh]" />

            {/* Pinned Scene Container */}
            <div ref={containerRef} className="fixed top-0 left-0 w-full h-screen z-20" />

            {/* HUD Interface */}
            <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-30">
                <div className="flex flex-col items-center space-y-4">
                    <div className={`backdrop-blur-xl border rounded-2xl px-8 py-4 shadow-2xl transition-all duration-500 ${darkMode
                        ? 'bg-black/30 border-gray-700'
                        : 'bg-white/30 border-gray-300'
                        }`}>
                        <div className="flex items-center space-x-8">
                            <div className="flex items-center space-x-3">
                                <div className="relative">
                                    <div className={`w-3 h-3 rounded-full animate-pulse ${darkMode ? 'bg-gradient-to-r from-gray-400 to-gray-500' : 'bg-gradient-to-r from-gray-600 to-gray-700'
                                        }`} />
                                    <div className={`absolute inset-0 rounded-full animate-ping opacity-20 ${darkMode ? 'bg-gray-400' : 'bg-gray-600'
                                        }`} />
                                </div>
                                <span className={`text-sm font-light tracking-wider ${darkMode ? 'text-gray-300' : 'text-gray-700'
                                    }`}>
                                    SYSTEM READY
                                </span>
                            </div>
                            <div className={`w-px h-6 ${darkMode ? 'bg-gray-600' : 'bg-gray-400'
                                }`} />
                            <div className="flex items-center space-x-3">
                                <div className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
                                <span className={`text-sm font-light tracking-wider ${darkMode ? 'text-gray-300' : 'text-gray-700'
                                    }`}>
                                    MONOCHROME
                                </span>
                            </div>
                            <div className={`w-px h-6 ${darkMode ? 'bg-gray-600' : 'bg-gray-400'
                                }`} />
                            <div className={`text-sm font-light tracking-wider ${darkMode ? 'text-gray-400' : 'text-gray-600'
                                }`}>
                                60Hz @ 800×600
                            </div>
                            <div className={`w-px h-6 ${darkMode ? 'bg-gray-600' : 'bg-gray-400'
                                }`} />
                            <div className={`px-3 py-1.5 rounded-full border ${darkMode
                                ? 'bg-white/10 border-gray-600'
                                : 'bg-black/10 border-gray-400'
                                }`}>
                                <span className={`text-xs font-medium tracking-wider ${darkMode ? 'text-gray-300' : 'text-gray-700'
                                    }`}>
                                    {darkMode ? 'DARK_MODE' : 'LIGHT_MODE'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="text-center space-y-2">
                        <div className="flex items-center justify-center space-x-2">
                            <div className={`w-2 h-2 rounded-full animate-pulse ${darkMode ? 'bg-gray-400' : 'bg-gray-600'
                                }`} />
                            <span className={`text-xs font-light tracking-wider animate-pulse ${darkMode ? 'text-gray-400' : 'text-gray-600'
                                }`}>
                                SCROLL FOR FULL EXPERIENCE
                            </span>
                            <div className={`w-2 h-2 rounded-full animate-pulse ${darkMode ? 'bg-gray-400' : 'bg-gray-600'
                                }`} />
                        </div>
                        <p className={`text-xs font-extralight tracking-wider ${darkMode ? 'text-gray-500' : 'text-gray-500'
                            }`}>
                            Click white button to toggle dark mode
                        </p>
                    </div>
                </div>
            </div>

            {/* Bottom gradient fade */}
            <div className={`fixed bottom-0 left-0 w-full h-40 z-10 pointer-events-none transition-opacity duration-500 ${darkMode
                ? 'bg-gradient-to-t from-gray-900 to-transparent'
                : 'bg-gradient-to-t from-gray-300 to-transparent'
                }`} />

            <section className={`relative z-10 transition-colors duration-500 ${darkMode ? 'bg-gray-900' : 'bg-gray-100'
                }`}>
                <Projects />
            </section>
        </div>
    );
}



