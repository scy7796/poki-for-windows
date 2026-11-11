//! The personalized developer disk image (iOS 17 and later). Poki downloads it itself on the
//! phone, from the same mirror; this module has it on the computer too, to mount it once as a
//! proof that automation can start, and to pre-seed Poki's container so the phone skips the
//! download. Files are checked against the SHA-384 digests in `BuildManifest.plist`, as Poki does.
use super::Phone;
use crate::{Error, Reporter, Result, paths};
use idevice::{IdeviceService, lockdown::LockdownClient, mobile_image_mounter::ImageMounter};
use sha2::{Digest, Sha384};
use std::path::{Path, PathBuf};

pub const MIRROR: &str = "https://raw.githubusercontent.com/doronz88/DeveloperDiskImage/main/PersonalizedImages/Xcode_iOS_DDI_Cryptex";
pub const FILES: [&str; 5] = ["BuildManifest.plist", "Image.dmg", "Image.dmg.trustcache", "Image.dmg.cryptex_info", "Image.dmg.root_hash"];
const PAYLOAD_KEYS: [&str; 4] = ["Cryptex1,GenericDmg", "Cryptex1,GenericTrustCache", "Cryptex1,CryptexInfoPlist", "Cryptex1,GenericVolume"];

pub fn dir() -> Result<PathBuf> {
    Ok(paths::cache_dir()?.join("ddi"))
}

/// Checks every payload in `dir` against the manifest; returns the image's build.
pub fn verify(dir: &Path) -> Result<String> {
    let manifest: plist::Dictionary = plist::from_file(dir.join("BuildManifest.plist"))
        .map_err(|_| Error::msg("BuildManifest.plist is missing or unreadable"))?;
    let identities = manifest.get("BuildIdentities").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let identity = identities
        .iter()
        .filter_map(|v| v.as_dictionary())
        .find(|id| {
            let m = id.get("Manifest").and_then(|m| m.as_dictionary());
            m.is_some_and(|m| PAYLOAD_KEYS.iter().all(|k| m.contains_key(*k)))
        })
        .ok_or_else(|| Error::msg("BuildManifest.plist has no Cryptex1 build identity"))?;
    let entries = identity.get("Manifest").and_then(|m| m.as_dictionary()).unwrap();
    for key in PAYLOAD_KEYS {
        let entry = entries.get(key).and_then(|e| e.as_dictionary());
        let path = entry
            .and_then(|e| e.get("Info"))
            .and_then(|i| i.as_dictionary())
            .and_then(|i| i.get("Path"))
            .and_then(|p| p.as_string())
            .filter(|p| !p.is_empty() && !p.starts_with('/') && !p.split('/').any(|s| s == ".."))
            .ok_or_else(|| Error::msg(format!("BuildManifest.plist gives no usable path for {key}")))?;
        let digest = entry.and_then(|e| e.get("Digest")).and_then(|d| d.as_data()).ok_or_else(|| Error::msg(format!("no digest for {key}")))?;
        let bytes = std::fs::read(dir.join(path)).map_err(|_| Error::msg(format!("{path} is missing")))?;
        if Sha384::digest(&bytes).as_slice() != digest {
            return Err(Error::msg(format!("{path} does not match its SHA-384 digest")));
        }
    }
    Ok(manifest.get("ProductBuildVersion").and_then(|v| v.as_string()).unwrap_or("unknown").to_string())
}

/// Makes sure the image is on this computer, downloading it when it is not. Returns its build.
pub async fn ensure(reporter: &Reporter) -> Result<(PathBuf, String)> {
    let dir = dir()?;
    if let Ok(build) = verify(&dir) {
        return Ok((dir, build));
    }
    reporter.step("ddi", "Downloading the developer disk image");
    let partial = dir.with_extension("partial");
    let _ = std::fs::remove_dir_all(&partial);
    std::fs::create_dir_all(&partial)?;
    let client = reqwest::Client::builder().user_agent(concat!("PokiSetup/", env!("CARGO_PKG_VERSION"))).build()?;
    for (i, name) in FILES.iter().enumerate() {
        reporter.part("ddi", i as f64 / FILES.len() as f64, Some(format!("Downloading {name}")));
        let res = client.get(format!("{MIRROR}/{name}")).send().await?;
        if !res.status().is_success() {
            let _ = std::fs::remove_dir_all(&partial);
            return Err(Error::msg(format!("downloading {name} failed with HTTP {}", res.status())));
        }
        std::fs::write(partial.join(name), res.bytes().await?)?;
    }
    let build = verify(&partial).inspect_err(|_| {
        let _ = std::fs::remove_dir_all(&partial);
    })?;
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::rename(&partial, &dir)?;
    reporter.done("ddi", Some(format!("Image build {build}.")));
    Ok((dir, build))
}

/// Whether a personalized image is mounted right now.
pub async fn mounted(phone: &Phone) -> Result<bool> {
    let provider = phone.provider()?;
    let mut mounter = ImageMounter::connect(&*provider).await?;
    let images = mounter.copy_devices().await?;
    Ok(images.iter().any(|i| {
        i.as_dictionary()
            .and_then(|d| d.get("DiskImageType"))
            .and_then(|t| t.as_string())
            .is_some_and(|t| t == "Personalized")
    }))
}

/// Mounts the image from this computer (needs internet for Apple's TSS signature). Poki mounts it
/// again by itself after every restart; this is the proof that the phone accepts it.
pub async fn mount(phone: &Phone, reporter: &Reporter) -> Result<()> {
    if mounted(phone).await? {
        reporter.note("mount", "The developer disk image is already mounted.");
        return Ok(());
    }
    let (dir, _) = ensure(reporter).await?;
    reporter.step("mount", "Mounting the developer disk image");
    let provider = phone.provider()?;
    let mut lockdown = LockdownClient::connect(&*provider).await?;
    let record = super::pairing::saved(&phone.udid)?.ok_or_else(|| Error::device("Pair the iPhone first."))?;
    lockdown.start_session(&record).await?;
    let chip = lockdown.get_value(Some("UniqueChipID"), None).await?.as_unsigned_integer().ok_or_else(|| Error::device("no UniqueChipID"))?;
    let mut mounter = ImageMounter::connect(&*provider).await?;
    let image = tokio::fs::read(dir.join("Image.dmg")).await?;
    let trust_cache = tokio::fs::read(dir.join("Image.dmg.trustcache")).await?;
    let manifest = tokio::fs::read(dir.join("BuildManifest.plist")).await?;
    let r = reporter.clone();
    mounter
        .mount_personalized_with_callback(&*provider, image, trust_cache, &manifest, None, chip, move |((n, d), _)| {
            let r = r.clone();
            async move { r.part("mount", if d == 0 { 0.0 } else { n as f64 / d as f64 }, None) }
        }, ())
        .await
        .map_err(|e| match e {
            idevice::IdeviceError::DeveloperModeNotEnabled => Error::NeedsPerson("Turn on Developer Mode on the iPhone first.".into()),
            other => Error::device(format!("Mounting failed: {other}. Apple's signing service must be reachable, and the phone must be unlocked.")),
        })?;
    reporter.done("mount", None);
    Ok(())
}

/// Copies the image into Poki's container so the phone does not download it.
pub async fn seed_container(phone: &Phone, bundle_id: &str, reporter: &Reporter) -> Result<()> {
    let (dir, _) = ensure(reporter).await?;
    reporter.step("seed", "Copying the disk image into Poki");
    for (i, name) in FILES.iter().enumerate() {
        let bytes = std::fs::read(dir.join(name))?;
        super::container::write_file(phone, bundle_id, &format!("{}/ddi/{name}", super::container::SUPPORT_DIR), &bytes).await?;
        reporter.part("seed", (i + 1) as f64 / FILES.len() as f64, Some(name.to_string()));
    }
    reporter.done("seed", None);
    Ok(())
}
