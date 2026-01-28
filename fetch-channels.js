const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const channelJsonPath = path.join(__dirname, 'channel.json');
const outputJsonPath = path.join(__dirname, 'output.json');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve(data);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

function parseM3U(content) {
  const channels = {};
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (line.startsWith('#EXTINF')) {
      const nextLine = lines[i + 1] ? lines[i + 1].trim() : '';
      
      if (nextLine && !nextLine.startsWith('#')) {
        let channelName = '';
        
        const tvgNameMatch = line.match(/tvg-name="([^"]+)"/);
        const commaMatch = line.match(/,([^,]+)$/);
        
        if (tvgNameMatch) {
          channelName = tvgNameMatch[1];
        } else if (commaMatch) {
          channelName = commaMatch[1].trim();
        }
        
        if (channelName && nextLine) {
          if (!channels[channelName]) {
            channels[channelName] = [];
          }
          channels[channelName].push(nextLine);
        }
      }
    }
  }
  
  return channels;
}

function parseTXT(content) {
  const channels = {};
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    if (trimmedLine.includes(',') && !trimmedLine.startsWith('#')) {
      const parts = trimmedLine.split(',');
      if (parts.length >= 2) {
        const channelName = parts[0].trim();
        const url = parts.slice(1).join(',').trim();
        
        if (channelName && url && url.startsWith('http')) {
          if (!channels[channelName]) {
            channels[channelName] = [];
          }
          channels[channelName].push(url);
        }
      }
    }
  }
  
  return channels;
}

function fuzzyMatch(channelName, targetNames) {
  const normalizedChannel = channelName.toLowerCase().replace(/[\s\-_]/g, '');
  
  for (const targetName of targetNames) {
    const normalizedTarget = targetName.toLowerCase().replace(/[\s\-_]/g, '');
    
    if (normalizedChannel.includes(normalizedTarget) || normalizedTarget.includes(normalizedChannel)) {
      return true;
    }
    
    if (normalizedChannel === normalizedTarget) {
      return true;
    }
  }
  
  return false;
}

function getAllChannelNames(channelData) {
  const names = [];
  
  if (channelData.cctv_channels) {
    if (channelData.cctv_channels.free_terrestrial_channel) {
      channelData.cctv_channels.free_terrestrial_channel.forEach(ch => names.push(ch.name));
    }
    if (channelData.cctv_channels.donghua_region) {
      channelData.cctv_channels.donghua_region.forEach(ch => names.push(ch.name));
    }
  }
  
  if (channelData.provincial_satellite_channel) {
    Object.values(channelData.provincial_satellite_channel).forEach(region => {
      region.forEach(ch => names.push(ch.name));
    });
  }
  
  if (channelData.digital_paid_channel) {
    channelData.digital_paid_channel.forEach(ch => names.push(ch.name));
  }
  
  return names;
}

function matchChannels(m3uChannels, channelData) {
  const result = [];
  const allChannelNames = getAllChannelNames(channelData);
  
  allChannelNames.forEach(channelName => {
    const matchedSources = [];
    const possibleNames = [channelName];
    
    const numberMatch = channelName.match(/(\d+)/);
    if (numberMatch) {
      const num = numberMatch[1];
      possibleNames.push(channelName.replace(num, '-' + num));
      possibleNames.push(channelName.replace(num, num));
    }
    
    for (const [m3uChannelName, sources] of Object.entries(m3uChannels)) {
      if (fuzzyMatch(m3uChannelName, possibleNames)) {
        matchedSources.push(...sources);
      }
    }
    
    if (matchedSources.length > 0) {
      result.push({
        name: channelName,
        sources: [...new Set(matchedSources)]
      });
    }
  });
  
  return result;
}

async function main() {
  try {
    console.log('读取频道配置文件...');
    const channelData = JSON.parse(fs.readFileSync(channelJsonPath, 'utf8'));
    const subscriptionUrls = channelData.subscription_urls || [];
    
    if (subscriptionUrls.length === 0) {
      console.log('未找到订阅地址');
      process.exit(0);
    }
    
    console.log('获取订阅地址内容...');
    const allM3UChannels = {};
    
    for (const url of subscriptionUrls) {
      console.log(`正在获取: ${url}`);
      try {
        const content = await fetchUrl(url);
        
        let channels;
        if (url.endsWith('.m3u') || url.endsWith('.m3u8')) {
          channels = parseM3U(content);
        } else {
          channels = parseTXT(content);
        }
        
        for (const [name, sources] of Object.entries(channels)) {
          if (!allM3UChannels[name]) {
            allM3UChannels[name] = [];
          }
          allM3UChannels[name].push(...sources);
        }
        
        console.log(`  成功获取 ${Object.keys(channels).length} 个频道`);
      } catch (err) {
        console.error(`  获取失败: ${err.message}`);
      }
    }
    
    console.log(`总共获取到 ${Object.keys(allM3UChannels).length} 个频道`);
    
    console.log('匹配频道...');
    const matchedChannels = matchChannels(allM3UChannels, channelData);
    
    console.log(`成功匹配 ${matchedChannels.length} 个频道`);
    
    console.log('写入输出文件...');
    fs.writeFileSync(outputJsonPath, JSON.stringify(matchedChannels, null, 2), 'utf8');
    
    console.log(`完成！结果已保存到 ${outputJsonPath}`);
    
    matchedChannels.forEach(ch => {
      console.log(`${ch.name}: ${ch.sources.length} 个直播源`);
    });
    
  } catch (err) {
    console.error('错误:', err);
    process.exit(1);
  }
}

main();
